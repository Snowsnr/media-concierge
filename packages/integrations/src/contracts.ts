import type {
  BrokerRequest,
  ArrConfiguration,
  ArrMovieLookup,
  ArrQueueStatus,
  HealthCheck,
  MediaMetadata,
  MediaRequest,
  ReleaseCandidate,
  SubtitleCandidate,
  SubtitleConfiguration,
  TorrentConfiguration,
  TorrentTelemetry,
} from '@media-concierge/shared';

export interface MetadataProvider {
  health(): Promise<HealthCheck>;
  search(query: string): Promise<MediaMetadata[]>;
}

export interface PublicRequestBroker {
  health(): Promise<HealthCheck>;
  pullPending(): Promise<BrokerRequest[]>;
  publishStatus(request: MediaRequest): Promise<void>;
}

export interface RadarrClient {
  health(): Promise<HealthCheck>;
  configuration(): Promise<ArrConfiguration>;
  lookup(tmdbId: number): Promise<ArrMovieLookup>;
  add(request: MediaRequest): Promise<ArrMovieLookup>;
  searchReleases(request: MediaRequest): Promise<ReleaseCandidate[]>;
  grab(release: ReleaseCandidate): Promise<{ downloadId: string }>;
  queue(tmdbId: number): Promise<ArrQueueStatus | null>;
  removeFromQueue(
    tmdbId: number,
    options: { removeFromClient: boolean; blocklist: boolean },
  ): Promise<boolean>;
}

export type SonarrClient = RadarrClient;

export interface TorrentClient {
  health(): Promise<HealthCheck>;
  configuration(): Promise<TorrentConfiguration>;
  status(downloadId: string): Promise<TorrentTelemetry | null>;
  pause(downloadId: string): Promise<void>;
  resume(downloadId: string): Promise<void>;
  reannounce(downloadId: string): Promise<void>;
}

export interface SubtitleClient {
  health(): Promise<HealthCheck>;
  configuration(): Promise<SubtitleConfiguration>;
  isRecognized(target: SubtitleTarget): Promise<boolean>;
  search(request: MediaRequest, target?: SubtitleTarget): Promise<SubtitleCandidate[]>;
  download(
    request: MediaRequest,
    target: SubtitleTarget | undefined,
    candidateId: string,
  ): Promise<SubtitleCandidate>;
}

export interface SubtitleTarget {
  kind: 'movie' | 'episode';
  externalId: number;
}

export interface MediaServerClient {
  health(): Promise<HealthCheck>;
  isAvailable(request: MediaRequest): Promise<boolean>;
  refreshLibrary(): Promise<void>;
}

export interface PushNotificationProvider {
  health(): Promise<HealthCheck>;
  notify(subjectId: string, title: string, body: string): Promise<void>;
}
