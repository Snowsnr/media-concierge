import { describe, expect, it, vi } from 'vitest';
import { mockCatalog } from './mock-data.js';
import { BazarrClientV1, BazarrHttpError } from './bazarr.js';

const apiKey = 'a'.repeat(32);
const request = {
  id: '10000000-0000-4000-8000-000000000001',
  media: mockCatalog.find((item) => item.type === 'movie')!,
} as Parameters<BazarrClientV1['search']>[0];
const target = { kind: 'movie' as const, externalId: 42 };
const json = (value: unknown, status = 200) => Response.json(value, { status });
const movie = (subtitles: unknown[] = []) => ({
  data: [{ radarrId: 42, profileId: 1, subtitles }],
  total: 1,
});

describe('BazarrClientV1', () => {
  it('rejects unsafe URLs and invalid API keys', () => {
    expect(() => new BazarrClientV1({ baseUrl: 'http://user:pass@bazarr:6767', apiKey })).toThrow(
      /without embedded credentials/,
    );
    expect(() => new BazarrClientV1({ baseUrl: 'http://bazarr:6767', apiKey: 'short' })).toThrow(
      /invalid/,
    );
  });

  it('authenticates through a header and reports version health without exposing the key', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).not.toContain(apiKey);
      expect(new Headers(init?.headers).get('X-API-KEY')).toBe(apiKey);
      return json({ data: { bazarr_version: '1.5.3' } });
    }) as typeof fetch;
    const client = new BazarrClientV1({ baseUrl: 'http://bazarr:6767/', apiKey, fetch: fetcher });

    await expect(client.health()).resolves.toEqual({
      name: 'Bazarr',
      status: 'healthy',
      message: 'Conectado · v1.5.3 · búsqueda manual',
    });
  });

  it('waits until Bazarr recognizes the exact Radarr movie ID', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [], total: 0 }))
      .mockResolvedValueOnce(json(movie().data ? movie() : {})) as typeof fetch;
    const client = new BazarrClientV1({ baseUrl: 'http://bazarr:6767', apiKey, fetch: fetcher });

    await expect(client.isRecognized(target)).resolves.toBe(false);
    await expect(client.isRecognized(target)).resolves.toBe(true);
  });

  it('maps and score-sorts manual results without exposing Bazarr tokens or URLs', async () => {
    const secretToken = `cache-${'s'.repeat(80)}`;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/api/movies?')) return json(movie());
      return json({
        data: [
          {
            dont_matches: ['source'],
            forced: 'False',
            hearing_impaired: 'True',
            language: 'Spanish',
            matches: ['title', 'year', 'release_group'],
            original_format: 'False',
            provider: 'OpenSubtitles.com',
            release_info: ['Movie.1080p.WEB-DL-GROUP'],
            score: 82.4,
            subtitle: secretToken,
            uploader: 'trusted-uploader',
            url: `https://provider.invalid/subtitle?token=${secretToken}`,
          },
          {
            dont_matches: [],
            forced: false,
            hearing_impaired: false,
            language: 'Spanish (Latin America)',
            matches: ['hash', 'title'],
            original_format: true,
            provider: 'SubDL',
            release_info: ['Movie.1080p.BluRay-GROUP'],
            score: 97,
            subtitle: 'opaque-cache-id',
            uploader: null,
          },
        ],
      });
    }) as typeof fetch;
    const client = new BazarrClientV1({ baseUrl: 'http://bazarr:6767', apiKey, fetch: fetcher });

    const results = await client.search(request, target);

    expect(results.map((candidate) => candidate.score)).toEqual([97, 82]);
    expect(results[0]).toMatchObject({
      language: 'Spanish (Latin America)',
      provider: 'SubDL',
      release: 'Movie.1080p.BluRay-GROUP',
      matches: ['Hash del archivo', 'Título'],
      uploader: 'No indicado',
    });
    expect(JSON.stringify(results)).not.toContain(secretToken);
    expect(JSON.stringify(results)).not.toContain('provider.invalid');
  });

  it('explains when a recognized movie has no language profile', async () => {
    const fetcher = vi.fn(async () =>
      json({ data: [{ radarrId: 42, profileId: null, subtitles: [] }], total: 1 }),
    ) as typeof fetch;
    const client = new BazarrClientV1({ baseUrl: 'http://bazarr:6767', apiKey, fetch: fetcher });

    await expect(client.search(request, target)).rejects.toThrow(/perfil de idioma/);
  });

  it('downloads only a freshly searched choice and polls until Bazarr indexes the subtitle', async () => {
    const calls: { path: string; body: string }[] = [];
    let movieReads = 0;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/api/movies')) {
        movieReads += 1;
        return json(
          movie(
            movieReads >= 3
              ? [
                  {
                    name: 'Spanish (Latino)',
                    code2: 'ea',
                    path: '/hidden/movie.ea.srt',
                    forced: false,
                    hi: false,
                  },
                ]
              : [],
          ),
        );
      }
      if (url.pathname.endsWith('/api/providers/movies') && init?.method !== 'POST') {
        return json({
          data: [
            {
              dont_matches: [],
              forced: 'False',
              hearing_impaired: 'False',
              language: 'Spanish (Latin America)',
              matches: ['hash'],
              original_format: 'True',
              provider: 'SubDL',
              release_info: ['Movie-GROUP'],
              score: 99,
              subtitle: 'private-cache-token',
              uploader: 'uploader',
            },
          ],
        });
      }
      calls.push({ path: url.pathname, body: String(init?.body ?? '') });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const client = new BazarrClientV1({
      baseUrl: 'http://bazarr:6767',
      apiKey,
      fetch: fetcher,
      confirmationTimeoutMs: 100,
      confirmationPollIntervalMs: 1,
    });
    const [candidate] = await client.search(request, target);

    await expect(client.download(request, target, '0'.repeat(64))).rejects.toThrow(
      /búsqueda de Bazarr expiró/,
    );
    await expect(client.download(request, target, candidate!.id)).resolves.toMatchObject({
      id: candidate!.id,
      language: 'Spanish (Latin America)',
      provider: 'SubDL',
    });
    expect(movieReads).toBeGreaterThanOrEqual(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/api/providers/movies');
    expect(new URLSearchParams(calls[0]?.body).get('subtitle')).toBe('private-cache-token');
    expect(new URLSearchParams(calls[0]?.body).get('original_format')).toBe('true');
  });

  it('redacts error responses and credentials', async () => {
    const client = new BazarrClientV1({
      baseUrl: 'http://bazarr:6767',
      apiKey,
      fetch: (async () =>
        new Response(`provider token ${'x'.repeat(80)}`, { status: 500 })) as typeof fetch,
    });

    const error = await client.configuration().catch((reason) => reason);
    expect(error).toBeInstanceOf(BazarrHttpError);
    expect(String(error)).not.toContain(apiKey);
    expect(String(error)).not.toContain('provider token');
  });
});
