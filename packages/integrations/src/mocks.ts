import type {
  HealthCheck,
  MediaRequest,
  ReleaseCandidate,
  SubtitleCandidate,
} from '@media-concierge/shared';
import type {
  MediaServerClient,
  MetadataProvider,
  PublicRequestBroker,
  PushNotificationProvider,
  RadarrClient,
  SonarrClient,
  SubtitleClient,
  TorrentClient,
} from './contracts.js';
import {
  buildMockReleases,
  buildMockSeriesReleases,
  buildMockSubtitles,
  mockCatalog,
} from './mock-data.js';

const mockHealth = (name: string): HealthCheck => ({
  name,
  status: 'mock',
  message: 'Adaptador simulado · sin conexión externa',
});

export class MockMetadataProvider implements MetadataProvider {
  async health() {
    return mockHealth('TMDB');
  }

  async search(query: string) {
    const normalized = query.trim().toLocaleLowerCase('es-MX');
    if (!normalized) return mockCatalog;
    return mockCatalog.filter((item) =>
      `${item.localizedTitle} ${item.originalTitle}`
        .toLocaleLowerCase('es-MX')
        .includes(normalized),
    );
  }
}

export class MockArrClient implements RadarrClient, SonarrClient {
  constructor(private readonly name = 'Radarr / Sonarr') {}
  async health() {
    return mockHealth(this.name);
  }
  async configuration() {
    return {
      mode: 'mock' as const,
      configured: false,
      version: null,
      qualityProfiles: [],
      rootFolders: [],
      selectedQualityProfileId: null,
      selectedRootFolderPath: null,
      issues: ['Adaptador simulado; no hay conexión externa.'],
    };
  }
  async lookup(_tmdbId: number) {
    return {
      exists: false,
      movieId: null,
      title: null,
      monitored: false,
      hasFile: false,
      movieFileId: null,
    };
  }
  async add(request: MediaRequest) {
    return {
      exists: true,
      movieId: request.media.tmdbId,
      title: request.media.localizedTitle,
      monitored: true,
      hasFile: false,
      movieFileId: null,
    };
  }
  async searchReleases(request: MediaRequest) {
    return request.media.type === 'series'
      ? buildMockSeriesReleases(request.id)
      : buildMockReleases(request.id);
  }
  async grab(release: ReleaseCandidate) {
    return { downloadId: `mock-${release.id}` };
  }
  async queue(_tmdbId: number) {
    return null;
  }
}

export class MockTorrentClient implements TorrentClient {
  async health() {
    return mockHealth('qBittorrent');
  }
  async getProgress(_downloadId: string) {
    return { progress: 0, state: 'mock' };
  }
  async pause(_downloadId: string) {}
  async resume(_downloadId: string) {}
  async reannounce(_downloadId: string) {}
}

export class MockSubtitleClient implements SubtitleClient {
  async health() {
    return mockHealth('Bazarr');
  }
  async search(request: MediaRequest) {
    return buildMockSubtitles(request.id);
  }
  async download(_candidate: SubtitleCandidate) {}
}

export class MockMediaServerClient implements MediaServerClient {
  async health() {
    return mockHealth('Jellyfin');
  }
  async isAvailable(_request: MediaRequest) {
    return true;
  }
  async refreshLibrary() {}
}

export class MockPublicBroker implements PublicRequestBroker {
  async health() {
    return mockHealth('Buzón público');
  }
  async pullPending() {
    return [];
  }
  async publishStatus(_request: MediaRequest) {}
}

export class MockPushProvider implements PushNotificationProvider {
  async health() {
    return mockHealth('Web Push');
  }
  async notify(_subjectId: string, _title: string, _body: string) {}
}
