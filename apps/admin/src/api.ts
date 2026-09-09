import type {
  DownloadControlAction,
  AppNotification,
  ArrConfiguration,
  ArrMovieLookup,
  ArrQueueStatus,
  CreatedInvitation,
  FamilyAccountSummary,
  HealthCheck,
  InvitationSummary,
  MediaRequest,
  NotificationConfig,
  ReleaseCandidate,
  SubtitleCandidate,
  SubtitleConfiguration,
  TorrentConfiguration,
} from '@media-concierge/shared';

const API_URL = import.meta.env.VITE_CONCIERGE_API_URL ?? 'http://localhost:4100';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'La API no respondió.');
  }
  return response.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  listRequests: () => request<MediaRequest[]>('/api/requests'),
  getRequest: (id: string) => request<MediaRequest>(`/api/requests/${id}`),
  decide: (id: string, action: 'approve' | 'reject' | 'clarify', note = '') =>
    post<MediaRequest>(`/api/requests/${id}/decision`, { action, note }),
  releases: (id: string) => request<ReleaseCandidate[]>(`/api/requests/${id}/releases`),
  selectRelease: (id: string, candidateId: string) =>
    post<MediaRequest>(`/api/requests/${id}/releases/select`, { candidateId }),
  advance: (id: string) => post<MediaRequest>(`/api/requests/${id}/advance`),
  subtitles: (id: string) => request<SubtitleCandidate[]>(`/api/requests/${id}/subtitles`),
  selectSubtitle: (id: string, candidateId: string, episodeId?: string) =>
    post<MediaRequest>(`/api/requests/${id}/subtitles/select`, { candidateId, episodeId }),
  confirmExistingSubtitle: (id: string) =>
    post<MediaRequest>(`/api/requests/${id}/subtitles/confirm-existing`, { confirmed: true }),
  verify: (id: string) => post<MediaRequest>(`/api/requests/${id}/verify`),
  setScenario: (id: string, scenario: MediaRequest['mockScenario']) =>
    post<MediaRequest>(`/api/requests/${id}/scenario`, { scenario }),
  controlDownload: (
    id: string,
    action: DownloadControlAction,
    options: { deleteData?: boolean; blocklist?: boolean } = {},
  ) => post<MediaRequest>(`/api/requests/${id}/download/control`, { action, ...options }),
  retryImport: (id: string) => post<MediaRequest>(`/api/requests/${id}/import/retry`),
  episodeAction: (
    id: string,
    episodeId: string,
    action: 'ready-without-subtitles' | 'retry-subtitles',
  ) => post<MediaRequest>(`/api/requests/${id}/episodes/${episodeId}`, { action }),
  health: () => request<HealthCheck[]>('/api/integrations/health'),
  radarrConfiguration: () => request<ArrConfiguration>('/api/integrations/radarr'),
  qbittorrentConfiguration: () => request<TorrentConfiguration>('/api/integrations/qbittorrent'),
  radarrStatus: (id: string) =>
    request<{
      configuration: ArrConfiguration;
      movie: ArrMovieLookup;
      queue: ArrQueueStatus | null;
    }>(`/api/requests/${id}/radarr`),
  refreshRadarr: (id: string) => post<MediaRequest>(`/api/requests/${id}/radarr/refresh`),
  bazarrConfiguration: () => request<SubtitleConfiguration>('/api/integrations/bazarr'),
  refreshBazarr: (id: string) => post<MediaRequest>(`/api/requests/${id}/bazarr/refresh`),
  retrySubtitles: (id: string) => post<MediaRequest>(`/api/requests/${id}/subtitles/retry`),
  reopenSubtitles: (id: string) => post<MediaRequest>(`/api/requests/${id}/subtitles/reopen`),
  demoStatus: () => request<{ resetEnabled: boolean }>('/api/demo/status'),
  reset: () => post<MediaRequest[]>('/api/demo/reset'),
  invitations: () => request<InvitationSummary[]>('/api/invitations'),
  createInvitation: (label: string, expiresInDays: number) =>
    post<CreatedInvitation>('/api/invitations', { label, expiresInDays }),
  revokeInvitation: (id: string) => post<{ revoked: boolean }>(`/api/invitations/${id}/revoke`),
  familyAccounts: () => request<FamilyAccountSummary[]>('/api/family-accounts'),
  resetFamilyPassword: (id: string, password: string) =>
    post<{ reset: boolean }>(`/api/family-accounts/${id}/reset-password`, { password }),
  notificationConfig: () => request<NotificationConfig>('/api/notifications/config'),
  notifications: () => request<AppNotification[]>('/api/notifications'),
  subscribeNotifications: (subscription: PushSubscriptionJSON) =>
    post<{ subscribed: boolean }>('/api/notifications/subscribe', {
      subscription,
      userAgent: navigator.userAgent,
    }),
  unsubscribeNotifications: (endpoint: string) =>
    post<{ subscribed: boolean }>('/api/notifications/unsubscribe', { endpoint }),
  testNotification: () => post<{ queued: boolean }>('/api/notifications/test'),
  markNotificationRead: (id: string) => post<{ read: boolean }>(`/api/notifications/${id}/read`),
};
