import { handleOptions, json, safeError } from '../_shared/http.ts';
import {
  deliverNotification,
  deliverPendingNotifications,
  enqueueNotification,
  getVapidPublicKey,
} from '../_shared/push.ts';
import { activeFamilyMember, adminClient, authenticatedUser } from '../_shared/supabase.ts';
import { bridgeAuthorized } from '../_shared/security.ts';

const endpointPattern = /^https:\/\/[^\s]+$/;
const keyPattern = /^[A-Za-z0-9_-]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const subscriptionInput = (body: Record<string, unknown> | null) => {
  const subscription = body?.subscription as Record<string, unknown> | undefined;
  const keys = subscription?.keys as Record<string, unknown> | undefined;
  const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint : '';
  const p256dh = typeof keys?.p256dh === 'string' ? keys.p256dh : '';
  const auth = typeof keys?.auth === 'string' ? keys.auth : '';
  if (
    !endpointPattern.test(endpoint) ||
    endpoint.length > 2048 ||
    !keyPattern.test(p256dh) ||
    p256dh.length < 40 ||
    p256dh.length > 256 ||
    !keyPattern.test(auth) ||
    auth.length < 16 ||
    auth.length > 128
  ) {
    return null;
  }
  return { endpoint, p256dh, auth };
};

const mapNotification = (row: Record<string, unknown>) => ({
  id: String(row.id),
  requestId: row.request_id ? String(row.request_id) : null,
  kind: String(row.kind),
  title: String(row.title),
  body: String(row.body),
  targetUrl: String(row.target_url),
  readAt: row.read_at ? String(row.read_at) : null,
  createdAt: String(row.created_at),
});

const listNotifications = async (audience: 'family' | 'admin', userId?: string) => {
  let query = adminClient()
    .from('notification_events')
    .select('id, request_id, kind, title, body, target_url, read_at, created_at')
    .eq('audience', audience)
    .order('created_at', { ascending: false })
    .limit(50);
  if (audience === 'family') query = query.eq('recipient_user_id', userId ?? '');
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapNotification(row));
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== 'POST') return safeError(request, 405, 'Método no permitido.');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  if (action === 'config') {
    try {
      return json(request, { enabled: true, publicKey: await getVapidPublicKey() });
    } catch (error) {
      console.error('VAPID configuration unavailable', {
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'Unknown configuration error',
      });
      return json(request, { enabled: false, publicKey: '' });
    }
  }

  const admin = adminClient();
  if (action.startsWith('admin-') || action === 'retry-pending') {
    if (!(await bridgeAuthorized(request))) return safeError(request, 401, 'No autorizado.');

    if (action === 'admin-subscribe') {
      const subscription = subscriptionInput(body);
      if (!subscription) return safeError(request, 400, 'Suscripción inválida.');
      const { error } = await admin.from('push_subscriptions').upsert(
        {
          audience: 'admin',
          user_id: null,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth_secret: subscription.auth,
          user_agent: typeof body?.userAgent === 'string' ? body.userAgent.slice(0, 500) : '',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      );
      if (error) return safeError(request, 500, 'No se pudo guardar la suscripción.');
      return json(request, { subscribed: true });
    }

    if (action === 'admin-unsubscribe') {
      const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
      if (!endpoint) return safeError(request, 400, 'Suscripción inválida.');
      await admin
        .from('push_subscriptions')
        .delete()
        .eq('audience', 'admin')
        .eq('endpoint', endpoint);
      return json(request, { subscribed: false });
    }

    if (action === 'admin-list') {
      try {
        return json(request, await listNotifications('admin'));
      } catch {
        return safeError(request, 500, 'No se pudieron cargar los avisos.');
      }
    }

    if (action === 'admin-read') {
      const id = typeof body?.notificationId === 'string' ? body.notificationId : '';
      if (!uuidPattern.test(id)) return safeError(request, 400, 'Aviso inválido.');
      await admin
        .from('notification_events')
        .update({ read_at: new Date().toISOString() })
        .eq('audience', 'admin')
        .eq('id', id);
      return json(request, { read: true });
    }

    if (action === 'admin-test') {
      const id = await enqueueNotification({
        audience: 'admin',
        kind: 'TEST',
        title: 'Media Concierge está listo',
        body: 'Las notificaciones privadas funcionan correctamente.',
        targetUrl: '/',
        dedupeKey: `admin:test:${crypto.randomUUID()}`,
      });
      await deliverNotification(id);
      return json(request, { queued: true });
    }

    if (action === 'retry-pending') {
      return json(request, await deliverPendingNotifications());
    }

    return safeError(request, 400, 'Acción inválida.');
  }

  const user = await authenticatedUser(request);
  const member = await activeFamilyMember(request);
  if (!user || !member) return safeError(request, 401, 'Sesión familiar inválida.');

  if (action === 'subscribe') {
    const subscription = subscriptionInput(body);
    if (!subscription) return safeError(request, 400, 'Suscripción inválida.');
    const { data: allowed } = await admin.rpc('check_rate_limit', {
      p_subject: user.id,
      p_action: 'push-subscribe',
      p_limit: 20,
      p_window_seconds: 3600,
    });
    if (!allowed) return safeError(request, 429, 'Demasiados intentos. Espera un momento.');
    const { error } = await admin.from('push_subscriptions').upsert(
      {
        audience: 'family',
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth_secret: subscription.auth,
        user_agent: typeof body?.userAgent === 'string' ? body.userAgent.slice(0, 500) : '',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );
    if (error) return safeError(request, 500, 'No se pudo guardar la suscripción.');
    return json(request, { subscribed: true });
  }

  if (action === 'unsubscribe') {
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
    if (!endpoint) return safeError(request, 400, 'Suscripción inválida.');
    await admin
      .from('push_subscriptions')
      .delete()
      .eq('audience', 'family')
      .eq('user_id', user.id)
      .eq('endpoint', endpoint);
    return json(request, { subscribed: false });
  }

  if (action === 'list') {
    try {
      return json(request, await listNotifications('family', user.id));
    } catch {
      return safeError(request, 500, 'No se pudieron cargar tus avisos.');
    }
  }

  if (action === 'read') {
    const id = typeof body?.notificationId === 'string' ? body.notificationId : '';
    if (!uuidPattern.test(id)) return safeError(request, 400, 'Aviso inválido.');
    await admin
      .from('notification_events')
      .update({ read_at: new Date().toISOString() })
      .eq('audience', 'family')
      .eq('recipient_user_id', user.id)
      .eq('id', id);
    return json(request, { read: true });
  }

  if (action === 'test') {
    const id = await enqueueNotification({
      audience: 'family',
      recipientUserId: user.id,
      kind: 'TEST',
      title: 'Tus avisos están listos',
      body: 'Media Concierge podrá avisarte aunque la web app esté cerrada.',
      targetUrl: '/notificaciones',
      dedupeKey: `family:${user.id}:test:${crypto.randomUUID()}`,
    });
    await deliverNotification(id);
    return json(request, { queued: true });
  }

  return safeError(request, 400, 'Acción inválida.');
});
