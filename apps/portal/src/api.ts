import { createClient } from '@supabase/supabase-js';
import {
  publicStatusLabel,
  type FamilyRequest,
  type MediaMetadata,
  type PublicStatusCode,
  type SeriesScope,
} from '@media-concierge/shared';

const API_URL = import.meta.env.VITE_CONCIERGE_API_URL ?? 'http://localhost:4100';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const remoteEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = remoteEnabled ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!) : null;
const publicRequestColumns = `
  id, tmdb_id, media_type, localized_title, original_title, release_year,
  overview, poster_url, note, scope, public_status, public_episodes,
  created_at, updated_at,
  public_request_history(id, public_status, note, created_at)
`;

interface PublicRequestRow {
  id: string;
  tmdb_id: number;
  media_type: 'movie' | 'series';
  localized_title: string;
  original_title: string;
  release_year: number;
  overview: string;
  poster_url: string;
  note: string | null;
  scope: SeriesScope | null;
  public_status: PublicStatusCode;
  public_episodes: FamilyRequest['publicEpisodes'];
  created_at: string;
  updated_at: string;
  public_request_history?: Array<{
    id: string;
    public_status: PublicStatusCode;
    note: string;
    created_at: string;
  }>;
  family_members?: { display_name: string } | Array<{ display_name: string }>;
}

async function localRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'No pudimos conectar con el concierge.');
  }
  return response.json() as Promise<T>;
}

const mapRow = (row: PublicRequestRow, fallbackName = 'Familia'): FamilyRequest => {
  const member = Array.isArray(row.family_members) ? row.family_members[0] : row.family_members;
  return {
    id: row.id,
    media: {
      tmdbId: row.tmdb_id,
      type: row.media_type,
      localizedTitle: row.localized_title,
      originalTitle: row.original_title,
      year: row.release_year,
      overview: row.overview,
      posterUrl: row.poster_url,
    },
    requesterName: member?.display_name ?? fallbackName,
    note: row.note,
    scope: row.scope,
    publicStatusCode: row.public_status,
    publicStatus: publicStatusLabel(row.public_status),
    publicEpisodes: row.public_episodes ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history: (row.public_request_history ?? [])
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map((entry) => ({
        id: entry.id,
        status: entry.public_status,
        label: publicStatusLabel(entry.public_status),
        note: entry.note,
        createdAt: entry.created_at,
      })),
  };
};

const remoteRows = async (id?: string, fallbackName = 'Familia') => {
  if (!supabase) throw new Error('Supabase no está configurado.');
  let query = supabase
    .from('public_requests')
    .select(publicRequestColumns)
    .order('created_at', { ascending: false });
  if (id) query = query.eq('id', id);
  const { data, error } = await query;
  if (error) throw new Error('No pudimos cargar tus solicitudes.');
  return (data as PublicRequestRow[]).map((row) => mapRow(row, fallbackName));
};

export const api = {
  remoteEnabled,
  inviteToken: () => new URLSearchParams(window.location.hash.slice(1)).get('invite'),
  currentProfile: async () => {
    if (!supabase) return localStorage.getItem('concierge-family-name');
    const { data } = await supabase.from('family_members').select('display_name').maybeSingle();
    return data?.display_name ?? null;
  },
  enter: async (displayName: string, inviteToken: string | null) => {
    if (!supabase) {
      localStorage.setItem('concierge-family-name', displayName);
      return displayName;
    }
    if (!inviteToken)
      throw new Error('Abre el enlace de invitación que te envió el administrador.');
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) await supabase.auth.signOut();
    const { error: signInError } = await supabase.auth.signInAnonymously();
    if (signInError) throw new Error('No pudimos iniciar una sesión segura.');
    const { error } = await supabase.functions.invoke('redeem-invite', {
      body: { token: inviteToken, displayName },
    });
    if (error) {
      await supabase.auth.signOut();
      throw new Error('La invitación expiró, fue utilizada o está revocada.');
    }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return displayName;
  },
  exit: async () => {
    if (supabase) await supabase.auth.signOut();
    localStorage.removeItem('concierge-family-name');
  },
  search: async (query: string) => {
    if (!supabase) {
      return localRequest<MediaMetadata[]>(`/api/catalog/search?q=${encodeURIComponent(query)}`);
    }
    const { data, error } = await supabase.functions.invoke<MediaMetadata[]>('tmdb-search', {
      body: { query },
    });
    if (error) throw new Error('No pudimos buscar en TMDB. Intenta nuevamente.');
    return data ?? [];
  },
  listRequests: async (requesterName: string) => {
    if (supabase) return remoteRows(undefined, requesterName);
    return localRequest<FamilyRequest[]>(
      `/api/public/requests?requesterName=${encodeURIComponent(requesterName)}`,
    );
  },
  getRequest: async (id: string, requesterName: string) => {
    if (supabase) {
      const rows = await remoteRows(id, requesterName);
      if (!rows[0]) throw new Error('Solicitud no encontrada.');
      return rows[0];
    }
    return localRequest<FamilyRequest>(
      `/api/public/requests/${id}?requesterName=${encodeURIComponent(requesterName)}`,
    );
  },
  createRequest: async (input: {
    media: MediaMetadata;
    requesterName: string;
    note: string;
    scope: SeriesScope | null;
    idempotencyKey: string;
  }) => {
    if (!supabase) {
      return localRequest<FamilyRequest>('/api/public/requests', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    }
    const { data, error } = await supabase.functions.invoke<PublicRequestRow>('create-request', {
      body: {
        tmdbId: input.media.tmdbId,
        mediaType: input.media.type,
        note: input.note,
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
      },
    });
    if (error || !data) throw new Error('No pudimos guardar tu solicitud.');
    return mapRow(data, input.requesterName);
  },
};
