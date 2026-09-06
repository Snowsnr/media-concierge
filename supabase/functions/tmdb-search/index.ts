import { activeFamilyMember, adminClient } from '../_shared/supabase.ts';
import { handleOptions, json, safeError } from '../_shared/http.ts';

type TmdbItem = {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
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

type MediaType = 'movie' | 'series';

const mapItem = (item: TmdbItem, localized?: TmdbItem) => {
  const type = item.media_type === 'tv' ? 'series' : item.media_type === 'movie' ? 'movie' : null;
  if (!type || item.adult || !item.poster_path) return null;
  const localizedTitle = localized?.title ?? localized?.name ?? item.title ?? item.name ?? '';
  const originalTitle = item.original_title ?? item.original_name ?? item.title ?? item.name ?? '';
  const date =
    localized?.release_date ??
    localized?.first_air_date ??
    item.release_date ??
    item.first_air_date;
  const year = Number(date?.slice(0, 4));
  if (!localizedTitle || !originalTitle || !Number.isInteger(year)) return null;
  return {
    tmdbId: item.id,
    type,
    localizedTitle,
    originalTitle,
    year,
    overview: localized?.overview || item.overview || '',
    posterUrl: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
  };
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== 'POST') return safeError(request, 405, 'Método no permitido.');
  const member = await activeFamilyMember(request);
  if (!member) return safeError(request, 403, 'Acceso familiar revocado o inválido.');

  const body = await request.json().catch(() => null);
  const query = typeof body?.query === 'string' ? body.query.trim().slice(0, 100) : '';
  const tmdbId = Number(body?.tmdbId);
  const mediaType: MediaType | null =
    body?.mediaType === 'movie' || body?.mediaType === 'series' ? body.mediaType : null;
  const detailRequested = body?.tmdbId !== undefined || body?.mediaType !== undefined;
  if (detailRequested && (!Number.isInteger(tmdbId) || tmdbId <= 0 || !mediaType)) {
    return safeError(request, 400, 'Título inválido.');
  }
  const admin = adminClient();
  const { data: allowed } = await admin.rpc('check_rate_limit', {
    p_subject: member.user_id,
    p_action: detailRequested ? 'tmdb-details' : 'tmdb-search',
    p_limit: 40,
    p_window_seconds: 60,
  });
  if (!allowed) return safeError(request, 429, 'Demasiadas búsquedas. Espera un momento.');

  const key = Deno.env.get('TMDB_API_READ_TOKEN');
  if (!key) return safeError(request, 503, 'La búsqueda todavía no está configurada.');
  const fetchTmdb = async (path: string, language: string) => {
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    url.searchParams.set('language', language);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error(`TMDB_${response.status}`);
    return (await response.json()) as TmdbItem;
  };

  if (detailRequested && mediaType) {
    try {
      const path = `${mediaType === 'series' ? 'tv' : 'movie'}/${tmdbId}`;
      const [spanish, english] = await Promise.all([
        fetchTmdb(path, 'es-MX'),
        fetchTmdb(path, 'en-US'),
      ]);
      const tmdbMediaType = mediaType === 'series' ? 'tv' : 'movie';
      const item = mapItem(
        { ...english, media_type: tmdbMediaType },
        { ...spanish, media_type: tmdbMediaType },
      );
      return item ? json(request, item) : safeError(request, 404, 'No encontramos ese título.');
    } catch {
      return safeError(request, 502, 'TMDB no respondió. Intenta nuevamente.');
    }
  }

  const endpoint = query ? 'search/multi' : 'trending/all/week';
  const buildUrl = (language: string) => {
    const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
    url.searchParams.set('language', language);
    url.searchParams.set('include_adult', 'false');
    if (query) url.searchParams.set('query', query);
    return url;
  };
  const fetchLanguage = async (language: string) => {
    const response = await fetch(buildUrl(language), {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error(`TMDB_${response.status}`);
    return ((await response.json()) as { results?: TmdbItem[] }).results ?? [];
  };

  try {
    const [spanish, english] = await Promise.all([fetchLanguage('es-MX'), fetchLanguage('en-US')]);
    const englishById = new Map(english.map((item) => [`${item.media_type}:${item.id}`, item]));
    const merged = new Map<string, ReturnType<typeof mapItem>>();
    for (const spanishItem of spanish) {
      const key = `${spanishItem.media_type}:${spanishItem.id}`;
      merged.set(key, mapItem(englishById.get(key) ?? spanishItem, spanishItem));
    }
    for (const englishItem of english) {
      const key = `${englishItem.media_type}:${englishItem.id}`;
      if (!merged.has(key)) merged.set(key, mapItem(englishItem));
    }
    return json(request, [...merged.values()].filter(Boolean).slice(0, 30));
  } catch {
    return safeError(request, 502, 'TMDB no respondió. Intenta nuevamente.');
  }
});
