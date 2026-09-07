import { handleOptions, json, safeError } from '../_shared/http.ts';
import { enqueueNotification } from '../_shared/push.ts';
import { activeFamilyMember, adminClient } from '../_shared/supabase.ts';

type MediaType = 'movie' | 'series';

type TmdbDetails = {
  id: number;
  adult?: boolean;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicRequestColumns = `
  id, tmdb_id, media_type, localized_title, original_title, release_year,
  overview, poster_url, note, scope, public_status, public_episodes,
  created_at, updated_at,
  public_request_history(id, public_status, note, created_at)
`;

const validScope = (type: MediaType, scope: unknown) => {
  if (type === 'movie') return scope === null || scope === undefined;
  if (!scope || typeof scope !== 'object') return false;
  const value = scope as Record<string, unknown>;
  if (value.kind === 'aired') return Object.keys(value).length === 1;
  if (value.kind === 'season') {
    return (
      Number.isInteger(value.seasonNumber) &&
      Number(value.seasonNumber) >= 0 &&
      Number(value.seasonNumber) <= 200
    );
  }
  return (
    value.kind === 'episode' &&
    Number.isInteger(value.seasonNumber) &&
    Number(value.seasonNumber) >= 0 &&
    Number(value.seasonNumber) <= 200 &&
    Number.isInteger(value.episodeNumber) &&
    Number(value.episodeNumber) >= 1 &&
    Number(value.episodeNumber) <= 1000
  );
};

const fetchDetails = async (type: MediaType, id: number, language: string, token: string) => {
  const endpoint = type === 'movie' ? 'movie' : 'tv';
  const url = new URL(`https://api.themoviedb.org/3/${endpoint}/${id}`);
  url.searchParams.set('language', language);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`TMDB_${response.status}`);
  return (await response.json()) as TmdbDetails;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== 'POST') return safeError(request, 405, 'Método no permitido.');

  const member = await activeFamilyMember(request);
  if (!member) return safeError(request, 403, 'Acceso familiar revocado o inválido.');

  const body = await request.json().catch(() => null);
  const tmdbId = Number(body?.tmdbId);
  const mediaType = body?.mediaType as MediaType;
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : '';
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  const scope = body?.scope ?? null;
  if (
    !Number.isInteger(tmdbId) ||
    tmdbId <= 0 ||
    !['movie', 'series'].includes(mediaType) ||
    !uuidPattern.test(idempotencyKey) ||
    note.length > 500 ||
    !validScope(mediaType, scope)
  ) {
    return safeError(request, 400, 'Datos de solicitud inválidos.');
  }

  const admin = adminClient();
  const { data: existing } = await admin
    .from('public_requests')
    .select(publicRequestColumns)
    .eq('requester_id', member.user_id)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing) return json(request, existing);

  const { data: allowed } = await admin.rpc('check_rate_limit', {
    p_subject: member.user_id,
    p_action: 'create-request',
    p_limit: 10,
    p_window_seconds: 3600,
  });
  if (!allowed) return safeError(request, 429, 'Llegaste al límite de solicitudes por hora.');

  const token = Deno.env.get('TMDB_API_READ_TOKEN');
  if (!token) return safeError(request, 503, 'TMDB todavía no está configurado.');

  try {
    const [spanish, english] = await Promise.all([
      fetchDetails(mediaType, tmdbId, 'es-MX', token),
      fetchDetails(mediaType, tmdbId, 'en-US', token),
    ]);
    if (spanish.adult || english.adult || !spanish.poster_path) {
      return safeError(request, 400, 'Ese título no está disponible para solicitar.');
    }
    const localizedTitle = spanish.title ?? spanish.name ?? '';
    const originalTitle =
      english.original_title ?? english.original_name ?? english.title ?? english.name ?? '';
    const date =
      spanish.release_date ??
      spanish.first_air_date ??
      english.release_date ??
      english.first_air_date;
    const releaseYear = Number(date?.slice(0, 4));
    if (!localizedTitle || !originalTitle || !Number.isInteger(releaseYear)) {
      return safeError(request, 400, 'TMDB devolvió metadatos incompletos.');
    }

    const { data: inserted, error: insertError } = await admin
      .from('public_requests')
      .insert({
        requester_id: member.user_id,
        idempotency_key: idempotencyKey,
        tmdb_id: tmdbId,
        media_type: mediaType,
        localized_title: localizedTitle,
        original_title: originalTitle,
        release_year: releaseYear,
        overview: spanish.overview || english.overview || '',
        poster_url: `https://image.tmdb.org/t/p/w500${spanish.poster_path}`,
        note: note || null,
        scope: mediaType === 'series' ? scope : null,
      })
      .select('id')
      .single();
    if (insertError) {
      const { data: repeated } = await admin
        .from('public_requests')
        .select(publicRequestColumns)
        .eq('requester_id', member.user_id)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (repeated) return json(request, repeated);
      return safeError(request, 500, 'No se pudo guardar la solicitud.');
    }

    const { data: created, error: readError } = await admin
      .from('public_requests')
      .select(publicRequestColumns)
      .eq('id', inserted.id)
      .single();
    if (readError) return safeError(request, 500, 'No se pudo confirmar la solicitud.');
    try {
      await enqueueNotification({
        audience: 'admin',
        requestId: inserted.id,
        kind: 'NEW_REQUEST',
        title: 'Nueva solicitud familiar',
        body: `${member.display_name} pidió ${localizedTitle}.`,
        targetUrl: '/',
        dedupeKey: `admin:new-request:${inserted.id}`,
      });
    } catch (notificationError) {
      console.error('new request notification failed', {
        message:
          notificationError instanceof Error
            ? notificationError.message
            : 'Unknown notification error',
      });
    }
    return json(request, created, 201);
  } catch {
    return safeError(request, 502, 'TMDB no respondió. Intenta nuevamente.');
  }
});
