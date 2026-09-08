import { describe, expect, it, vi } from 'vitest';
import type { MediaRequest } from '@media-concierge/shared';
import { mockCatalog } from './mock-data.js';
import { RadarrClientV3, RadarrHttpError } from './radarr.js';

const requestFixture = (): MediaRequest => ({
  id: '10000000-0000-4000-8000-000000000001',
  publicRequestId: null,
  media: mockCatalog[0]!,
  requesterName: 'Ana',
  note: null,
  scope: null,
  state: 'ADDING_TO_ARR',
  publicStatus: 'En preparación',
  progress: 0,
  selectedReleaseId: null,
  downloadId: null,
  torrent: null,
  selectedSubtitleId: null,
  mockScenario: 'none',
  episodes: [],
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
  history: [],
});

const json = (value: unknown, status = 200) => Response.json(value, { status });

describe('RadarrClientV3', () => {
  it('rejects URLs with embedded credentials or non-HTTP protocols', () => {
    expect(
      () => new RadarrClientV3({ baseUrl: 'http://user:pass@radarr:7878', apiKey: 'test-api-key' }),
    ).toThrow(/without embedded credentials/);
    expect(
      () => new RadarrClientV3({ baseUrl: 'file:///etc/passwd', apiKey: 'test-api-key' }),
    ).toThrow(/HTTP/);
  });

  it('validates configuration and reports Radarr health without leaking the key', async () => {
    const apiKey = 'private-test-api-key';
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).not.toContain(apiKey);
      expect(new Headers(init?.headers).get('X-Api-Key')).toBe(apiKey);
      const url = String(input);
      if (url.endsWith('/system/status')) return json({ version: '5.27.5' });
      if (url.endsWith('/qualityprofile')) return json([{ id: 4, name: 'HD-1080p' }]);
      if (url.endsWith('/rootfolder'))
        return json([{ id: 2, path: '/movies', accessible: true, freeSpace: 900_000_000_000 }]);
      if (url.endsWith('/health')) return json([]);
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new RadarrClientV3({
      baseUrl: 'http://radarr:7878/',
      apiKey,
      qualityProfileId: 4,
      rootFolderPath: '/movies',
      fetch: fetcher,
    });

    await expect(client.health()).resolves.toEqual({
      name: 'Radarr',
      status: 'healthy',
      message: 'Conectado · v5.27.5',
    });
  });

  it('adds a movie without starting an automatic search', async () => {
    let addedBody: Record<string, unknown> | null = null;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/movie?tmdbId=')) return json([]);
      if (url.endsWith('/system/status')) return json({ version: '5.27.5' });
      if (url.endsWith('/qualityprofile')) return json([{ id: 4, name: 'HD-1080p' }]);
      if (url.endsWith('/rootfolder'))
        return json([{ id: 2, path: '/movies', accessible: true, freeSpace: 1000 }]);
      if (url.includes('/movie/lookup/tmdb'))
        return json({ tmdbId: 945961, title: 'Alien: Romulus', monitored: false });
      if (url.endsWith('/movie') && init?.method === 'POST') {
        addedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({ id: 42, tmdbId: 945961, title: 'Alien: Romulus', monitored: true });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new RadarrClientV3({
      baseUrl: 'http://radarr:7878',
      apiKey: 'private-test-api-key',
      qualityProfileId: 4,
      rootFolderPath: '/movies',
      tagIds: [9],
      fetch: fetcher,
    });

    await expect(client.add(requestFixture())).resolves.toMatchObject({
      exists: true,
      movieId: 42,
    });
    expect(addedBody).toMatchObject({
      qualityProfileId: 4,
      rootFolderPath: '/movies',
      monitored: true,
      tags: [9],
      addOptions: { searchForMovie: false },
    });
  });

  it('maps interactive releases, preserves Radarr rejections, and grabs only the chosen result', async () => {
    let grabbed: Record<string, unknown> | null = null;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/movie?tmdbId='))
        return json([{ id: 42, tmdbId: 945961, title: 'Alien: Romulus', monitored: true }]);
      if (url.includes('/release?movieId='))
        return json([
          {
            guid: 'release-guid-low-score',
            title: 'Alien.Romulus.2024.720p.WEB-DL.x264-SLOW',
            size: 15_000_000_000,
            indexerId: 4,
            indexer: 'Private Indexer',
            ageHours: 24,
            seeders: 1,
            leechers: 0,
            infoHash: 'LOW123',
            rejected: false,
            rejections: [],
            customFormatScore: 0,
            customFormats: [],
            languages: [{ name: 'English' }],
            quality: { quality: { name: 'WEBDL-720p', resolution: 720, source: 'webdl' } },
          },
          {
            guid: 'release-guid-1',
            title: 'Alien.Romulus.2024.1080p.BluRay.DDP5.1.x265-GROUP',
            size: 5_000_000_000,
            indexerId: 3,
            indexer: 'Private Indexer',
            ageHours: 12,
            seeders: 30,
            leechers: 4,
            infoHash: 'ABC123',
            rejected: true,
            rejections: ['Release in blocklist'],
            customFormatScore: 10,
            customFormats: [{ name: 'x265' }],
            languages: [{ name: 'English' }],
            quality: { quality: { name: 'Bluray-1080p', resolution: 1080, source: 'bluray' } },
          },
        ]);
      if (url.endsWith('/release') && init?.method === 'POST') {
        grabbed = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new RadarrClientV3({
      baseUrl: 'http://radarr:7878',
      apiKey: 'private-test-api-key',
      fetch: fetcher,
    });
    const releases = await client.searchReleases(requestFixture());

    expect(releases).toHaveLength(2);
    expect(releases[0]!.score).toBeGreaterThan(releases[1]!.score);
    expect(releases[0]).toMatchObject({
      resolution: '1080p',
      videoCodec: 'x265 / HEVC',
      seeds: 30,
      rejections: ['Release in blocklist'],
    });
    expect(releases[0]!.scoreReasons.map((reason) => reason.label)).toContain(
      'Radarr reporta rechazos',
    );
    await expect(client.grab(releases[0]!)).resolves.toEqual({ downloadId: 'ABC123' });
    expect(grabbed).toMatchObject({ guid: 'release-guid-1', indexerId: 3 });
  });

  it('maps queue progress and returns redacted HTTP errors', async () => {
    let removedUrl = '';
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/movie?tmdbId='))
        return json([{ id: 42, tmdbId: 945961, title: 'Alien: Romulus', monitored: true }]);
      if (url.includes('/queue?'))
        return json({
          records: [
            {
              id: 7,
              movieId: 42,
              title: 'Chosen release',
              status: 'downloading',
              trackedDownloadState: 'downloading',
              size: 1000,
              sizeleft: 250,
              downloadId: 'ABC123',
              errorMessage: null,
            },
          ],
        });
      if (url.includes('/queue/7?')) {
        removedUrl = url;
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new RadarrClientV3({
      baseUrl: 'http://radarr:7878',
      apiKey: 'private-test-api-key',
      fetch: fetcher,
    });
    await expect(client.queue(945961)).resolves.toMatchObject({
      progress: 75,
      downloadId: 'ABC123',
    });
    await expect(
      client.removeFromQueue(945961, { removeFromClient: true, blocklist: true }),
    ).resolves.toBe(true);
    expect(removedUrl).toContain('removeFromClient=true');
    expect(removedUrl).toContain('blocklist=true');
    expect(removedUrl).toContain('skipRedownload=true');

    const failing = new RadarrClientV3({
      baseUrl: 'http://radarr:7878',
      apiKey: 'private-test-api-key',
      fetch: (async () =>
        json({ apiKey: 'should-not-leak', path: '/movies' }, 500)) as typeof fetch,
    });
    const error = await failing.lookup(945961).catch((reason) => reason);
    expect(error).toBeInstanceOf(RadarrHttpError);
    expect(String(error)).not.toContain('should-not-leak');
    expect(String(error)).not.toContain('/movies');
  });
});
