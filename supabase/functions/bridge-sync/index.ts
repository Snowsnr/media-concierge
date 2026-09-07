import { handleOptions, json, safeError } from '../_shared/http.ts';
import {
  enqueueNotification,
  schedulePendingDelivery,
  type NotificationKind,
} from '../_shared/push.ts';
import { adminClient } from '../_shared/supabase.ts';
import { bridgeAuthorized } from '../_shared/security.ts';

const statuses = new Set([
  'PENDING',
  'NEEDS_INFO',
  'APPROVED',
  'PREPARING',
  'READY',
  'REJECTED',
  'FAILED',
]);

type BridgeRow = {
  id: string;
  tmdb_id: number;
  media_type: 'movie' | 'series';
  localized_title: string;
  original_title: string;
  release_year: number;
  overview: string;
  poster_url: string;
  note: string | null;
  scope: Record<string, unknown> | null;
  created_at: string;
  family_members: { display_name: string } | Array<{ display_name: string }>;
};

const familyNotification = (
  status: string,
  title: string,
  note: string,
): { kind: NotificationKind; title: string; body: string } | null => {
  if (status === 'APPROVED') {
    return { kind: 'APPROVED', title: 'Solicitud aprobada', body: `${title} fue aprobada.` };
  }
  if (status === 'NEEDS_INFO') {
    return { kind: 'NEEDS_INFO', title: 'Necesitamos un dato', body: note };
  }
  if (status === 'READY') {
    return { kind: 'READY', title: 'Ya está disponible', body: `${title} ya está en Jellyfin.` };
  }
  if (status === 'REJECTED') {
    return { kind: 'REJECTED', title: 'Solicitud rechazada', body: note };
  }
  if (status === 'FAILED') {
    return { kind: 'FAILED', title: 'No pudimos completar la solicitud', body: note };
  }
  return null;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== 'POST') return safeError(request, 405, 'Método no permitido.');
  if (!(await bridgeAuthorized(request))) return safeError(request, 401, 'No autorizado.');
  const body = await request.json().catch(() => null);
  const admin = adminClient();

  if (body?.action === 'health') {
    schedulePendingDelivery();
    return json(request, { status: 'ok' });
  }

  if (body?.action === 'pull') {
    const { data, error } = await admin
      .from('public_requests')
      .select(
        'id, tmdb_id, media_type, localized_title, original_title, release_year, overview, poster_url, note, scope, created_at, family_members!inner(display_name)',
      )
      .eq('public_status', 'PENDING')
      .is('bridge_synced_at', null)
      .order('created_at')
      .limit(50);
    if (error) return safeError(request, 500, 'No se pudo leer el buzón.');
    const rows = (data ?? []) as unknown as BridgeRow[];
    const now = new Date().toISOString();
    const ids = rows.map((item) => item.id);
    if (ids.length)
      await admin.from('public_requests').update({ bridge_claimed_at: now }).in('id', ids);
    schedulePendingDelivery();
    return json(
      request,
      rows.map((item) => ({
        publicRequestId: item.id,
        media: {
          tmdbId: item.tmdb_id,
          type: item.media_type,
          localizedTitle: item.localized_title,
          originalTitle: item.original_title,
          year: item.release_year,
          overview: item.overview,
          posterUrl: item.poster_url,
        },
        requesterName: Array.isArray(item.family_members)
          ? item.family_members[0]?.display_name
          : item.family_members?.display_name,
        note: item.note,
        scope: item.scope,
        createdAt: item.created_at,
      })),
    );
  }

  if (body?.action === 'update') {
    const requestId = typeof body?.publicRequestId === 'string' ? body.publicRequestId : '';
    const status = typeof body?.status === 'string' ? body.status : '';
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : '';
    if (!requestId || !statuses.has(status) || !note) {
      return safeError(request, 400, 'Actualización inválida.');
    }
    const { data: current } = await admin
      .from('public_requests')
      .select('public_status, requester_id, localized_title')
      .eq('id', requestId)
      .maybeSingle();
    const { error } = await admin
      .from('public_requests')
      .update({
        public_status: status,
        public_episodes: Array.isArray(body?.publicEpisodes) ? body.publicEpisodes : [],
        bridge_synced_at: new Date().toISOString(),
      })
      .eq('id', requestId);
    if (error) return safeError(request, 500, 'No se pudo actualizar el buzón.');
    if (current?.public_status !== status) {
      await admin.from('public_request_history').insert({
        request_id: requestId,
        public_status: status,
        note,
      });
      const inferredApproval =
        status === 'PREPARING' &&
        (current?.public_status === 'PENDING' || current?.public_status === 'NEEDS_INFO');
      const notification = familyNotification(
        inferredApproval ? 'APPROVED' : status,
        current?.localized_title ?? 'Tu solicitud',
        note,
      );
      if (notification && current?.requester_id) {
        try {
          await enqueueNotification({
            audience: 'family',
            recipientUserId: current.requester_id,
            requestId,
            ...notification,
            targetUrl: `/solicitudes/${requestId}`,
            dedupeKey: `family:${requestId}:${notification.kind}`,
          });
        } catch (notificationError) {
          console.error('family notification failed', {
            message:
              notificationError instanceof Error
                ? notificationError.message
                : 'Unknown notification error',
          });
        }
      }
    }
    schedulePendingDelivery();
    return json(request, { updated: true });
  }

  return safeError(request, 400, 'Acción inválida.');
});
