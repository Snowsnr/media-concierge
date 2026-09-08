import { describe, expect, it, vi } from 'vitest';
import { QBittorrentClientV2, QBittorrentHttpError } from './qbittorrent.js';

const apiKey = `qbt_${'a'.repeat(28)}`;
const text = (value: string, status = 200, headers?: HeadersInit) =>
  new Response(value, { status, headers });
const json = (value: unknown, status = 200) => Response.json(value, { status });

describe('QBittorrentClientV2', () => {
  it('rejects unsafe URLs and incomplete authentication', () => {
    expect(
      () =>
        new QBittorrentClientV2({
          baseUrl: 'http://user:pass@qbittorrent:8080',
          apiKey,
        }),
    ).toThrow(/without embedded credentials/);
    expect(
      () => new QBittorrentClientV2({ baseUrl: 'http://qbittorrent:8080', username: 'admin' }),
    ).toThrow(/complete username\/password pair/);
  });

  it('uses API-key auth and reports version health without exposing the key', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).not.toContain(apiKey);
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${apiKey}`);
      if (String(input).endsWith('/app/version')) return text('v5.2.4');
      if (String(input).endsWith('/app/webapiVersion')) return text('2.14.1');
      throw new Error(`Unexpected URL: ${String(input)}`);
    }) as typeof fetch;
    const client = new QBittorrentClientV2({
      baseUrl: 'http://qbittorrent:8080/',
      apiKey,
      fetch: fetcher,
    });

    await expect(client.health()).resolves.toEqual({
      name: 'qBittorrent',
      status: 'healthy',
      message: 'Conectado · v5.2.4 · WebAPI 2.14.1',
    });
  });

  it('maps real torrent telemetry and redacts tracker secrets', async () => {
    const hash = 'b'.repeat(40);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/torrents/info?')) {
        return json([
          {
            hash: hash.toUpperCase(),
            name: 'Movie.2026.1080p.x265-GROUP',
            state: 'stalledDL',
            progress: 0.25,
            total_size: 1_000,
            downloaded: 250,
            amount_left: 750,
            dlspeed: 125,
            eta: 6,
            num_seeds: 2,
            num_complete: 20,
            num_leechs: 3,
            num_incomplete: 30,
            availability: 1.7,
            ratio: 0.15,
          },
        ]);
      }
      if (url.includes('/torrents/trackers?')) {
        return json([
          {
            url: `https://tracker.example/announce?passkey=${'s'.repeat(40)}`,
            status: 4,
            msg: `Failed ${'s'.repeat(40)} at https://tracker.example/private`,
          },
        ]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new QBittorrentClientV2({
      baseUrl: 'http://qbittorrent:8080',
      apiKey,
      fetch: fetcher,
    });

    await expect(client.status(hash)).resolves.toMatchObject({
      hash,
      state: 'stalled',
      progress: 25,
      totalBytes: 1_000,
      downloadedBytes: 250,
      remainingBytes: 750,
      downloadSpeedBytes: 125,
      seedsConnected: 2,
      seedsTotal: 20,
      peersConnected: 3,
      peersTotal: 30,
      availability: 1.7,
      ratio: 0.15,
      trackers: [
        {
          host: 'tracker.example',
          status: 'error',
          message: 'Failed [dato oculto] at [URL oculta]',
        },
      ],
    });
  });

  it('uses stop/start on qBittorrent 5 and legacy pause/resume on qBittorrent 4', async () => {
    const hash = 'c'.repeat(40);
    const calls: { path: string; body: string }[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/app/version')) return text('v5.2.4');
      calls.push({ path, body: String(init?.body ?? '') });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const client = new QBittorrentClientV2({
      baseUrl: 'http://qbittorrent:8080',
      apiKey,
      fetch: fetcher,
    });
    await client.pause(hash);
    await client.resume(hash);
    await client.reannounce(hash);
    expect(calls.map((call) => call.path)).toEqual([
      '/api/v2/torrents/stop',
      '/api/v2/torrents/start',
      '/api/v2/torrents/reannounce',
    ]);
    expect(calls.every((call) => call.body === `hashes=${hash}`)).toBe(true);

    const legacyCalls: string[] = [];
    const legacy = new QBittorrentClientV2({
      baseUrl: 'http://qbittorrent:8080',
      username: 'admin',
      password: 'private-password',
      fetch: (async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/auth/login'))
          return text('Ok.', 200, { 'set-cookie': 'SID=test-session; path=/' });
        if (path.endsWith('/app/version')) return text('v4.6.7');
        legacyCalls.push(path);
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });
    await legacy.pause(hash);
    await legacy.resume(hash);
    expect(legacyCalls).toEqual(['/api/v2/torrents/pause', '/api/v2/torrents/resume']);
  });

  it('logs in once with credentials and returns redacted HTTP errors', async () => {
    let loginCount = 0;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/auth/login')) {
        loginCount += 1;
        expect(String(init?.body)).toContain('username=admin');
        return text('Ok.', 200, { 'set-cookie': 'SID=test-session; path=/' });
      }
      expect(new Headers(init?.headers).get('Cookie')).toBe('SID=test-session');
      if (path.endsWith('/app/version')) return text('v5.1.2');
      if (path.endsWith('/app/webapiVersion')) return text('2.11.3');
      return json({ password: 'should-not-leak' }, 500);
    }) as typeof fetch;
    const client = new QBittorrentClientV2({
      baseUrl: 'http://qbittorrent:8080',
      username: 'admin',
      password: 'private-password',
      fetch: fetcher,
    });
    await client.configuration();
    expect(loginCount).toBe(1);
    const error = await client.status('d'.repeat(40)).catch((reason) => reason);
    expect(error).toBeInstanceOf(QBittorrentHttpError);
    expect(String(error)).not.toContain('should-not-leak');
    expect(String(error)).not.toContain('private-password');
  });
});
