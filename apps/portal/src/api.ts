import { createClient } from '@supabase/supabase-js';
import {
  publicStatusLabel,
  type AppNotification,
  type FamilyRequest,
  type MediaMetadata,
  type NotificationConfig,
  type PublicStatusCode,
  type SeriesScope,
} from '@media-concierge/shared';

const API_URL = import.meta.env.VITE_CONCIERGE_API_URL ?? 'http://localhost:4100';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const remoteEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = remoteEnabled ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!) : null;
const normalizeUsername = (value: string) => value.trim().toLowerCase();
const loginEmail = (username: string) => `${normalizeUsername(username)}@users.diegohomelab.fyi`;
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

export interface FamilyProfile {
  displayName: string;
  username: string | null;
}

const functionErrorMessage = async (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const body = (await context
        .clone()
        .json()
        .catch(() => null)) as { message?: string } | null;
      if (body?.message) return body.message;
    }
  }
  return fallback;
};

const withTimeout = async <T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
};

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
    if (!supabase) {
      const displayName = localStorage.getItem('concierge-family-name');
      return displayName ? { displayName, username: 'demo' } : null;
    }
    const { data } = await supabase
      .from('family_members')
      .select('display_name, username')
      .maybeSingle();
    return data
      ? { displayName: data.display_name, username: data.username as string | null }
      : null;
  },
  register: async (
    displayName: string,
    username: string,
    password: string,
    inviteToken: string | null,
  ): Promise<FamilyProfile> => {
    if (!supabase) {
      localStorage.setItem('concierge-family-name', displayName);
      return { displayName, username: normalizeUsername(username) || 'demo' };
    }
    if (!inviteToken)
      throw new Error('Abre el enlace de invitación que te envió el administrador.');
    await supabase.auth.signOut();
    const normalized = normalizeUsername(username);
    const { error } = await supabase.functions.invoke('account-access', {
      body: { action: 'register', token: inviteToken, displayName, username: normalized, password },
    });
    if (error) {
      throw new Error(await functionErrorMessage(error, 'No pudimos crear tu cuenta.'));
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginEmail(normalized),
      password,
    });
    if (signInError) throw new Error('La cuenta se creó, pero no pudimos iniciar sesión.');
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return { displayName, username: normalized };
  },
  upgradeAccount: async (username: string, password: string): Promise<FamilyProfile> => {
    if (!supabase) {
      const displayName = localStorage.getItem('concierge-family-name') ?? username;
      return { displayName, username: normalizeUsername(username) };
    }
    const normalized = normalizeUsername(username);
    const { data, error } = await supabase.functions.invoke<{ profile: FamilyProfile }>(
      'account-access',
      { body: { action: 'upgrade', username: normalized, password } },
    );
    if (error || !data?.profile) {
      throw new Error(await functionErrorMessage(error, 'No pudimos crear tu acceso permanente.'));
    }
    await supabase.auth.signOut();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginEmail(normalized),
      password,
    });
    if (signInError) throw new Error('La cuenta se actualizó, pero no pudimos iniciar sesión.');
    return data.profile;
  },
  login: async (username: string, password: string): Promise<FamilyProfile> => {
    if (!supabase) {
      const displayName = normalizeUsername(username) || 'Familia';
      localStorage.setItem('concierge-family-name', displayName);
      return { displayName, username: normalizeUsername(username) || 'demo' };
    }
    await supabase.auth.signOut();
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail(username),
      password,
    });
    if (error) throw new Error('Usuario o contraseña incorrectos.');
    const profile = await api.currentProfile();
    if (!profile) {
      await supabase.auth.signOut();
      throw new Error('Esta cuenta no tiene acceso familiar activo.');
    }
    return profile;
  },
  exit: async () => {
    if (supabase) {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const subscription = await (
          await navigator.serviceWorker.ready
        ).pushManager
          .getSubscription()
          .catch(() => null);
        if (subscription) {
          await supabase.functions
            .invoke('notifications', {
              body: { action: 'unsubscribe', endpoint: subscription.endpoint },
            })
            .catch(() => undefined);
          await subscription.unsubscribe().catch(() => false);
        }
      }
      await supabase.auth.signOut();
    }
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
  getMedia: async (tmdbId: number, mediaType: MediaMetadata['type']) => {
    if (!supabase) {
      const items = await api.search('');
      const item = items.find(
        (candidate) => candidate.tmdbId === tmdbId && candidate.type === mediaType,
      );
      if (!item) throw new Error('No encontramos ese título.');
      return item;
    }
    const { data, error } = await withTimeout(
      supabase.functions.invoke<MediaMetadata>('tmdb-search', {
        body: { tmdbId, mediaType },
      }),
      10_000,
      'El detalle tardó demasiado. Intenta nuevamente.',
    );
    if (error || !data) {
      throw new Error(await functionErrorMessage(error, 'No pudimos cargar el detalle de TMDB.'));
    }
    return data;
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
  notificationConfig: async (): Promise<NotificationConfig> => {
    if (!supabase) return { enabled: false, publicKey: '' };
    const { data, error } = await supabase.functions.invoke<NotificationConfig>('notifications', {
      body: { action: 'config' },
    });
    if (error || !data) return { enabled: false, publicKey: '' };
    return data;
  },
  notifications: async (): Promise<AppNotification[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.functions.invoke<AppNotification[]>('notifications', {
      body: { action: 'list' },
    });
    if (error) throw new Error(await functionErrorMessage(error, 'No pudimos cargar tus avisos.'));
    return data ?? [];
  },
  subscribeNotifications: async (subscription: PushSubscriptionJSON) => {
    if (!supabase) return { subscribed: false };
    const { data, error } = await supabase.functions.invoke<{ subscribed: boolean }>(
      'notifications',
      {
        body: { action: 'subscribe', subscription, userAgent: navigator.userAgent },
      },
    );
    if (error) throw new Error(await functionErrorMessage(error, 'No pudimos activar los avisos.'));
    return data ?? { subscribed: false };
  },
  unsubscribeNotifications: async (endpoint: string) => {
    if (!supabase) return { subscribed: false };
    const { data, error } = await supabase.functions.invoke<{ subscribed: boolean }>(
      'notifications',
      { body: { action: 'unsubscribe', endpoint } },
    );
    if (error)
      throw new Error(await functionErrorMessage(error, 'No pudimos desactivar los avisos.'));
    return data ?? { subscribed: false };
  },
  markNotificationRead: async (notificationId: string) => {
    if (!supabase) return { read: true };
    const { data, error } = await supabase.functions.invoke<{ read: boolean }>('notifications', {
      body: { action: 'read', notificationId },
    });
    if (error) throw new Error(await functionErrorMessage(error, 'No pudimos abrir el aviso.'));
    return data ?? { read: true };
  },
  testNotification: async () => {
    if (!supabase) return { queued: false };
    const { data, error } = await supabase.functions.invoke<{ queued: boolean }>('notifications', {
      body: { action: 'test' },
    });
    if (error) throw new Error(await functionErrorMessage(error, 'No pudimos enviar la prueba.'));
    return data ?? { queued: false };
  },
};
