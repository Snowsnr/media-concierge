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
  async health() {
    return mockHealth('Radarr / Sonarr');
  }
  async lookup(_tmdbId: number) {
    return { exists: false };
  }
  async add(_request: MediaRequest) {}
  async searchReleases(request: MediaRequest) {
    return request.media.type === 'series'
      ? buildMockSeriesReleases(request.id)
      : buildMockReleases(request.id);
  }
  async grab(release: ReleaseCandidate) {
    return { downloadId: `mock-${release.id}` };
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
