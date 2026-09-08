import { z } from 'zod';
import type {
  HealthCheck,
  TorrentActivityState,
  TorrentConfiguration,
  TorrentTelemetry,
  TorrentTrackerStatus,
} from '@media-concierge/shared';
import type { TorrentClient } from './contracts.js';

const torrentSchema = z
  .object({
    hash: z.string().regex(/^[a-fA-F0-9]{40,64}$/),
    name: z.string().max(2_000),
    state: z.string().max(100),
    progress: z.number().min(0).max(1),
    size: z.number().nonnegative().optional().default(0),
    total_size: z.number().nonnegative().optional().default(0),
    downloaded: z.number().nonnegative().optional().default(0),
    amount_left: z.number().nonnegative().optional().default(0),
    dlspeed: z.number().nonnegative().optional().default(0),
    eta: z.number().int().optional().default(-1),
    num_seeds: z.number().int().optional().default(-1),
    num_complete: z.number().int().optional().default(-1),
    num_leechs: z.number().int().optional().default(-1),
    num_incomplete: z.number().int().optional().default(-1),
    availability: z.number().optional().default(-1),
    ratio: z.number().nonnegative().optional().default(0),
  })
  .passthrough();

const trackerSchema = z
  .object({
    url: z.string().max(4_000),
    status: z.number().int(),
    msg: z.string().max(2_000).nullable().optional(),
  })
  .passthrough();

export interface QBittorrentClientOptions {
  baseUrl: string;
  apiKey?: string | null;
  username?: string | null;
  password?: string | null;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const normalizedBaseUrl = (value: string) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('QBITTORRENT_URL must be an HTTP(S) URL without embedded credentials.');
  }
  if (url.search || url.hash)
    throw new Error('QBITTORRENT_URL cannot contain a query or fragment.');
  return url.href.replace(/\/+$/, '');
};

const trackerHost = (value: string) => {
  try {
    return new URL(value).hostname || 'Tracker privado';
  } catch {
    if (/dht/i.test(value)) return 'DHT';
    if (/pex/i.test(value)) return 'PeX';
    if (/lsd/i.test(value)) return 'LSD';
    return 'Tracker privado';
  }
};

const redactMessage = (value: string | null | undefined) => {
  if (!value) return null;
  return value
    .replace(/(?:https?|udp):\/\/\S+/gi, '[URL oculta]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[dato oculto]')
    .slice(0, 300);
};

const trackerStatus = (status: number): TorrentTrackerStatus['status'] => {
  if (status === 0) return 'disabled';
  if (status === 1) return 'pending';
  if (status === 2) return 'working';
  if (status === 3) return 'updating';
  if (status === 4) return 'error';
  return 'unknown';
};

const activityState = (rawState: string, progress: number): TorrentActivityState => {
  const state = rawState.toLowerCase();
  if (state.includes('missingfiles') || state.includes('error')) return 'errored';
  if (state.includes('stalleddl')) return 'stalled';
  if (state.includes('pauseddl') || state.includes('stoppeddl')) return 'paused';
  if (state.includes('checking')) return 'checking';
  if (progress >= 1 || /(?:uploading|stalledup|pausedup|stoppedup|forcedup|queuedup)/.test(state))
    return 'completed';
  if (state.includes('queued') || state.includes('allocating') || state.includes('metadl'))
    return 'queued';
  if (state.includes('downloading') || state.includes('forceddl')) return 'downloading';
  return 'unknown';
};

export class QBittorrentHttpError extends Error {
  constructor(
    public readonly status: number,
    operation: string,
  ) {
    super(`qBittorrent respondió ${status} durante ${operation}.`);
    this.name = 'QBittorrentHttpError';
  }
}

export class QBittorrentClientV2 implements TorrentClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly authMode: 'api-key' | 'credentials';
  private readonly origin: string;
  private cookie: string | null = null;
  private loginPromise: Promise<void> | null = null;
  private cachedVersion: string | null = null;

  constructor(private readonly options: QBittorrentClientOptions) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
    this.origin = new URL(this.baseUrl).origin;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetcher = options.fetch ?? fetch;
    const apiKey = options.apiKey?.trim() ?? '';
    const username = options.username?.trim() ?? '';
    const password = options.password ?? '';
    if (apiKey) {
      if (!/^qbt_[A-Za-z0-9]{28}$/.test(apiKey)) {
        throw new Error('QBITTORRENT_API_KEY has an invalid format.');
      }
      this.authMode = 'api-key';
    } else {
      if (!username || !password) {
        throw new Error('qBittorrent requires an API key or a complete username/password pair.');
      }
      this.authMode = 'credentials';
    }
  }

  async health(): Promise<HealthCheck> {
    try {
      const configuration = await this.configuration();
      return {
        name: 'qBittorrent',
        status: configuration.issues.length ? 'degraded' : 'healthy',
        message: `Conectado · ${configuration.version ?? 'versión desconocida'} · WebAPI ${configuration.webApiVersion ?? 'desconocida'}`,
      };
    } catch (error) {
      return {
        name: 'qBittorrent',
        status: 'offline',
        message: error instanceof Error ? error.message : 'qBittorrent no respondió.',
      };
    }
  }

  async configuration(): Promise<TorrentConfiguration> {
    const [version, webApiVersion] = await Promise.all([
      this.text('app/version', 'consulta de versión'),
      this.text('app/webapiVersion', 'consulta de WebAPI'),
    ]);
    this.cachedVersion = version;
    const issues: string[] = [];
    if (this.authMode === 'api-key') {
      const parts = webApiVersion.split('.').map(Number);
      const major = parts[0] ?? Number.NaN;
      const minor = parts[1] ?? Number.NaN;
      const patch = parts[2] ?? 0;
      if (
        !Number.isFinite(major) ||
        !Number.isFinite(minor) ||
        major < 2 ||
        (major === 2 && (minor < 14 || (minor === 14 && patch < 1)))
      ) {
        issues.push('La API key requiere qBittorrent 5.2+ o WebAPI 2.14.1+.');
      }
    }
    return {
      mode: 'qbittorrent',
      configured: issues.length === 0,
      version,
      webApiVersion,
      authMode: this.authMode,
      issues,
    };
  }

  async status(downloadId: string): Promise<TorrentTelemetry | null> {
    const hash = this.optionalHash(downloadId);
    if (!hash) return null;
    const torrents = await this.json(
      `torrents/info?hashes=${encodeURIComponent(hash)}`,
      z.array(torrentSchema).max(10),
      'consulta de torrent',
    );
    const torrent = torrents.find((candidate) => candidate.hash.toLowerCase() === hash);
    if (!torrent) return null;
    const trackers = await this.json(
      `torrents/trackers?hash=${encodeURIComponent(hash)}`,
      z.array(trackerSchema).max(100),
      'consulta de trackers',
    );
    const mappedTrackers = trackers.map((tracker) => ({
      host: trackerHost(tracker.url),
      status: trackerStatus(tracker.status),
      message: redactMessage(tracker.msg),
    }));
    const state = activityState(torrent.state, torrent.progress);
    const trackerError = mappedTrackers.find(
      (tracker) => tracker.status === 'error' && tracker.message,
    );
    const errorMessage =
      state === 'errored'
        ? torrent.state.toLowerCase().includes('missing')
          ? 'qBittorrent reporta archivos faltantes.'
          : 'qBittorrent reporta un error en el torrent.'
        : trackerError
          ? `${trackerError.host}: ${trackerError.message}`
          : null;
    const totalBytes = torrent.total_size || torrent.size;
    const downloadedBytes = torrent.downloaded || Math.round(totalBytes * torrent.progress);
    const remainingBytes = torrent.amount_left || Math.max(0, totalBytes - downloadedBytes);
    return {
      hash,
      name: torrent.name,
      state,
      rawState: torrent.state,
      progress: Math.round(torrent.progress * 100),
      totalBytes,
      downloadedBytes,
      remainingBytes,
      downloadSpeedBytes: torrent.dlspeed,
      etaSeconds: torrent.eta < 0 || torrent.eta >= 8_640_000 ? null : torrent.eta,
      seedsConnected: Math.max(0, torrent.num_seeds),
      seedsTotal: Math.max(0, torrent.num_complete),
      peersConnected: Math.max(0, torrent.num_leechs),
      peersTotal: Math.max(0, torrent.num_incomplete),
      availability: torrent.availability < 0 ? null : torrent.availability,
      ratio: torrent.ratio,
      trackers: mappedTrackers,
      errorMessage,
      updatedAt: new Date().toISOString(),
    };
  }

  async pause(downloadId: string): Promise<void> {
    await this.control(await this.commandFor('pause'), downloadId, 'pausa');
  }

  async resume(downloadId: string): Promise<void> {
    await this.control(await this.commandFor('resume'), downloadId, 'reanudación');
  }

  async reannounce(downloadId: string): Promise<void> {
    await this.control('reannounce', downloadId, 'reannounce');
  }

  private async commandFor(action: 'pause' | 'resume') {
    const version = this.cachedVersion ?? (await this.text('app/version', 'consulta de versión'));
    this.cachedVersion = version;
    const major = Number(version.replace(/^v/i, '').split('.')[0]);
    if (Number.isFinite(major) && major >= 5) return action === 'pause' ? 'stop' : 'start';
    return action;
  }

  private async control(command: string, downloadId: string, operation: string) {
    const hash = this.requiredHash(downloadId);
    await this.request(
      `torrents/${command}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ hashes: hash }).toString(),
      },
      operation,
    );
  }

  private optionalHash(value: string) {
    const normalized = value.trim().toLowerCase();
    return /^[a-f0-9]{40,64}$/.test(normalized) ? normalized : null;
  }

  private requiredHash(value: string) {
    const hash = this.optionalHash(value);
    if (!hash) throw new Error('La solicitud todavía no tiene un hash válido de qBittorrent.');
    return hash;
  }

  private async text(path: string, operation: string) {
    const response = await this.request(path, undefined, operation);
    return (await response.text()).trim().slice(0, 100);
  }

  private async json<Schema extends z.ZodTypeAny>(
    path: string,
    schema: Schema,
    operation: string,
  ): Promise<z.output<Schema>> {
    const response = await this.request(path, undefined, operation);
    const text = await response.text();
    if (text.length > 2_000_000)
      throw new Error(`qBittorrent devolvió demasiados datos durante ${operation}.`);
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`qBittorrent devolvió JSON inválido durante ${operation}.`);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success)
      throw new Error(`qBittorrent devolvió datos inválidos durante ${operation}.`);
    return parsed.data;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    operation: string,
    retryAuthentication = true,
  ): Promise<Response> {
    if (this.authMode === 'credentials') await this.ensureLogin();
    const response = await this.fetcher(`${this.baseUrl}/api/v2/${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Origin: this.origin,
        Referer: `${this.baseUrl}/`,
        ...(this.authMode === 'api-key'
          ? { Authorization: `Bearer ${this.options.apiKey!.trim()}` }
          : { Cookie: this.cookie! }),
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 403 && this.authMode === 'credentials' && retryAuthentication) {
      this.cookie = null;
      await this.ensureLogin();
      return this.request(path, init, operation, false);
    }
    if (!response.ok) throw new QBittorrentHttpError(response.status, operation);
    return response;
  }

  private async ensureLogin() {
    if (this.cookie) return;
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  private async login() {
    const response = await this.fetcher(`${this.baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: this.origin,
        Referer: `${this.baseUrl}/`,
      },
      body: new URLSearchParams({
        username: this.options.username!,
        password: this.options.password!,
      }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await response.text()).trim();
    if (!response.ok || body !== 'Ok.') {
      throw new Error('qBittorrent rechazó las credenciales de Web UI.');
    }
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie;
    const setCookies = getSetCookie ? getSetCookie.call(response.headers) : [];
    const header = setCookies.join('; ') || response.headers.get('set-cookie') || '';
    const sid = header.match(/(?:^|[;,]\s*)(SID=[^;,\s]+)/i)?.[1];
    if (!sid) throw new Error('qBittorrent no devolvió una sesión válida.');
    this.cookie = sid;
  }
}
