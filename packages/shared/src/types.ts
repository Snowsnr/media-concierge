export const requestStates = [
  'REQUESTED',
  'SYNCED_TO_HOMELAB',
  'NEEDS_CLARIFICATION',
  'APPROVED',
  'REJECTED',
  'ADDING_TO_ARR',
  'SELECTING_RELEASE',
  'QUEUED',
  'DOWNLOADING',
  'PAUSED',
  'STALLED',
  'IMPORTING',
  'WAITING_FOR_BAZARR',
  'SUBTITLES_REQUIRED',
  'VERIFYING_JELLYFIN',
  'READY',
  'FAILED',
  'CANCELLED',
] as const;

export type RequestState = (typeof requestStates)[number];
export type MediaType = 'movie' | 'series';
export type MockScenario =
  'none' | 'stalled' | 'download-error' | 'import-delay' | 'no-subtitles' | 'jellyfin-delay';

export type EpisodeState =
  | 'UNAIRED'
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'PAUSED'
  | 'IMPORTED'
  | 'SUBTITLES_REQUIRED'
  | 'READY'
  | 'READY_WITHOUT_SUBTITLES'
  | 'FAILED';
export type SeriesScope =
  | { kind: 'season'; seasonNumber: number }
  | { kind: 'episode'; seasonNumber: number; episodeNumber: number }
  | { kind: 'aired' };

export interface MediaMetadata {
  tmdbId: number;
  type: MediaType;
  localizedTitle: string;
  originalTitle: string;
  year: number;
  overview: string;
  posterUrl: string;
}

export interface RequestHistoryEntry {
  id: string;
  fromState: RequestState | null;
  toState: RequestState;
  actor: 'family' | 'admin' | 'system';
  note: string;
  createdAt: string;
}

export interface EpisodeProgress {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  aired: boolean;
  state: EpisodeState;
  progress: number;
  downloadGroupId: string | null;
  selectedSubtitleId: string | null;
}

export interface MediaRequest {
  id: string;
  publicRequestId: string | null;
  media: MediaMetadata;
  requesterName: string;
  note: string | null;
  scope: SeriesScope | null;
  state: RequestState;
  publicStatus: PublicStatus;
  progress: number;
  selectedReleaseId: string | null;
  downloadId: string | null;
  torrent: TorrentTelemetry | null;
  selectedSubtitleId: string | null;
  mockScenario: MockScenario;
  episodes: EpisodeProgress[];
  createdAt: string;
  updatedAt: string;
  history: RequestHistoryEntry[];
}

export type PublicStatus =
  | 'Pendiente'
  | 'Necesita información'
  | 'Aprobada'
  | 'En preparación'
  | 'Disponible'
  | 'Rechazada'
  | 'No se pudo completar';

export type PublicStatusCode =
  'PENDING' | 'NEEDS_INFO' | 'APPROVED' | 'PREPARING' | 'READY' | 'REJECTED' | 'FAILED';

export interface PublicHistoryEntry {
  id: string;
  status: PublicStatusCode;
  label: PublicStatus;
  note: string;
  createdAt: string;
}

export interface PublicEpisodeProgress {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  aired: boolean;
  status: 'UPCOMING' | 'PREPARING' | 'READY' | 'READY_WITHOUT_SUBTITLES' | 'ATTENTION';
  progress: number;
}

export interface FamilyRequest {
  id: string;
  media: MediaMetadata;
  requesterName: string;
  note: string | null;
  scope: SeriesScope | null;
  publicStatusCode: PublicStatusCode;
  publicStatus: PublicStatus;
  publicEpisodes: PublicEpisodeProgress[];
  createdAt: string;
  updatedAt: string;
  history: PublicHistoryEntry[];
}

export interface BrokerRequest {
  publicRequestId: string;
  media: MediaMetadata;
  requesterName: string;
  note: string | null;
  scope: SeriesScope | null;
  createdAt: string;
}

export interface InvitationSummary {
  id: string;
  label: string;
  expiresAt: string;
  createdAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedInvitation extends InvitationSummary {
  inviteUrl: string;
}

export interface FamilyAccountSummary {
  userId: string;
  displayName: string;
  username: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export type NotificationKind =
  'NEW_REQUEST' | 'APPROVED' | 'NEEDS_INFO' | 'READY' | 'REJECTED' | 'FAILED' | 'TEST';

export interface AppNotification {
  id: string;
  requestId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  targetUrl: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationConfig {
  enabled: boolean;
  publicKey: string;
}

export interface ReleaseScoreReason {
  points: number;
  label: string;
}

export interface ReleaseCandidate {
  id: string;
  requestId: string;
  title: string;
  coverage: string;
  quality: string;
  resolution: '2160p' | '1080p' | '720p';
  source: string;
  videoCodec: string;
  audioCodec: string;
  sizeBytes: number;
  indexer: string;
  seeds: number;
  leechers: number;
  languages: string[];
  isRepack: boolean;
  rejections: string[];
  customFormats: string[];
  ageHours: number;
  score: number;
  scoreReasons: ReleaseScoreReason[];
}

export interface ArrMovieLookup {
  exists: boolean;
  movieId: number | null;
  title: string | null;
  monitored: boolean;
  hasFile: boolean;
  movieFileId: number | null;
}

export interface ArrQualityProfile {
  id: number;
  name: string;
}

export interface ArrRootFolder {
  id: number;
  path: string;
  accessible: boolean;
  freeSpace: number | null;
}

export interface ArrConfiguration {
  mode: 'mock' | 'radarr';
  configured: boolean;
  version: string | null;
  qualityProfiles: ArrQualityProfile[];
  rootFolders: ArrRootFolder[];
  selectedQualityProfileId: number | null;
  selectedRootFolderPath: string | null;
  issues: string[];
}

export interface ArrQueueStatus {
  queueId: number;
  movieId: number;
  title: string;
  status: string;
  trackedState: string;
  progress: number;
  downloadId: string | null;
  errorMessage: string | null;
}

export type TorrentActivityState =
  | 'downloading'
  | 'stalled'
  | 'paused'
  | 'completed'
  | 'errored'
  | 'checking'
  | 'queued'
  | 'unknown';

export interface TorrentTrackerStatus {
  host: string;
  status: 'disabled' | 'pending' | 'working' | 'updating' | 'error' | 'unknown';
  message: string | null;
}

export interface TorrentTelemetry {
  hash: string;
  name: string;
  state: TorrentActivityState;
  rawState: string;
  progress: number;
  totalBytes: number;
  downloadedBytes: number;
  remainingBytes: number;
  downloadSpeedBytes: number;
  etaSeconds: number | null;
  seedsConnected: number;
  seedsTotal: number;
  peersConnected: number;
  peersTotal: number;
  availability: number | null;
  ratio: number;
  trackers: TorrentTrackerStatus[];
  errorMessage: string | null;
  updatedAt: string;
}

export interface TorrentConfiguration {
  mode: 'mock' | 'qbittorrent';
  configured: boolean;
  version: string | null;
  webApiVersion: string | null;
  authMode: 'mock' | 'api-key' | 'credentials';
  issues: string[];
}

export interface SubtitleCandidate {
  id: string;
  requestId: string;
  language: string;
  provider: string;
  score: number;
  release: string;
  matches: string[];
  mismatches: string[];
  hearingImpaired: boolean;
  forced: boolean;
  uploader: string;
}

export type DownloadControlAction = 'pause' | 'resume' | 'reannounce' | 'retry-release' | 'cancel';

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'offline' | 'mock';
  message: string;
}

export const publicStatusFor = (state: RequestState): PublicStatus => {
  if (state === 'REQUESTED' || state === 'SYNCED_TO_HOMELAB') return 'Pendiente';
  if (state === 'NEEDS_CLARIFICATION') return 'Necesita información';
  if (state === 'APPROVED') return 'Aprobada';
  if (state === 'READY') return 'Disponible';
  if (state === 'REJECTED' || state === 'CANCELLED') return 'Rechazada';
  if (state === 'FAILED') return 'No se pudo completar';
  return 'En preparación';
};

export const publicStatusCodeFor = (state: RequestState): PublicStatusCode => {
  if (state === 'REQUESTED' || state === 'SYNCED_TO_HOMELAB') return 'PENDING';
  if (state === 'NEEDS_CLARIFICATION') return 'NEEDS_INFO';
  if (state === 'APPROVED') return 'APPROVED';
  if (state === 'READY') return 'READY';
  if (state === 'REJECTED' || state === 'CANCELLED') return 'REJECTED';
  if (state === 'FAILED') return 'FAILED';
  return 'PREPARING';
};

export const publicStatusLabel = (code: PublicStatusCode): PublicStatus => {
  const labels: Record<PublicStatusCode, PublicStatus> = {
    PENDING: 'Pendiente',
    NEEDS_INFO: 'Necesita información',
    APPROVED: 'Aprobada',
    PREPARING: 'En preparación',
    READY: 'Disponible',
    REJECTED: 'Rechazada',
    FAILED: 'No se pudo completar',
  };
  return labels[code];
};

export const toFamilyRequest = (request: MediaRequest): FamilyRequest => {
  const publicNote = (entry: RequestHistoryEntry) => {
    if (entry.toState === 'NEEDS_CLARIFICATION' || entry.toState === 'REJECTED') return entry.note;
    if (entry.toState === 'READY') return 'El contenido ya está disponible en Jellyfin.';
    if (entry.toState === 'APPROVED') return 'La solicitud fue aprobada.';
    if (entry.toState === 'REQUESTED') return 'Solicitud recibida.';
    if (entry.toState === 'FAILED') return 'No pudimos completar la solicitud.';
    return 'Estamos preparando tu contenido.';
  };
  return {
    id: request.id,
    media: request.media,
    requesterName: request.requesterName,
    note: request.note,
    scope: request.scope,
    publicStatusCode: publicStatusCodeFor(request.state),
    publicStatus: publicStatusFor(request.state),
    publicEpisodes: request.episodes.map((episode) => ({
      id: episode.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      aired: episode.aired,
      status: !episode.aired
        ? 'UPCOMING'
        : episode.state === 'READY'
          ? 'READY'
          : episode.state === 'READY_WITHOUT_SUBTITLES'
            ? 'READY_WITHOUT_SUBTITLES'
            : episode.state === 'FAILED'
              ? 'ATTENTION'
              : 'PREPARING',
      progress: episode.progress,
    })),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    history: request.history.map((entry) => {
      const status = publicStatusCodeFor(entry.toState);
      return {
        id: entry.id,
        status,
        label: publicStatusLabel(status),
        note: publicNote(entry),
        createdAt: entry.createdAt,
      };
    }),
  };
};
