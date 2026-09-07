import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  ArrConfiguration,
  ArrMovieLookup,
  ArrQueueStatus,
  HealthCheck,
  MediaRequest,
  ReleaseCandidate,
} from '@media-concierge/shared';
import type { RadarrClient } from './contracts.js';

const movieSchema = z
  .object({
    id: z.number().int().positive().optional(),
    title: z.string().max(500).nullable().optional(),
    tmdbId: z.number().int().positive(),
    monitored: z.boolean().optional().default(false),
    hasFile: z.boolean().nullable().optional().default(false),
    movieFileId: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();

const qualityProfileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().max(200).nullable().optional(),
});

const rootFolderSchema = z.object({
  id: z.number().int().positive(),
  path: z.string().max(2_000).nullable().optional(),
  accessible: z.boolean().optional().default(false),
  freeSpace: z.number().nullable().optional(),
});

const systemSchema = z.object({ version: z.string().max(100).nullable().optional() });
const healthIssueSchema = z.object({
  type: z.string().max(50).optional().default('ok'),
  message: z.string().max(1_000).nullable().optional(),
});
const releaseSchema = z
  .object({
    id: z.number().int().optional(),
    guid: z.string().max(2_000).nullable().optional(),
    title: z.string().max(2_000).nullable().optional(),
    size: z.number().nonnegative().optional().default(0),
    indexerId: z.number().int().optional(),
    indexer: z.string().max(300).nullable().optional(),
    ageHours: z.number().nonnegative().optional().default(0),
    seeders: z.number().int().nullable().optional(),
    leechers: z.number().int().nullable().optional(),
    rejected: z.boolean().optional().default(false),
    rejections: z.array(z.string().max(1_000)).max(100).nullable().optional(),
    infoHash: z.string().max(500).nullable().optional(),
    customFormatScore: z.number().int().optional().default(0),
    customFormats: z
      .array(z.object({ name: z.string().max(300).nullable().optional() }).passthrough())
      .max(100)
      .nullable()
      .optional(),
    languages: z
      .array(z.object({ name: z.string().max(200).nullable().optional() }).passthrough())
      .max(50)
      .nullable()
      .optional(),
    quality: z
      .object({
        quality: z
          .object({
            name: z.string().max(300).nullable().optional(),
            resolution: z.number().int().nonnegative().optional(),
            source: z.union([z.string(), z.number()]).optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const queueSchema = z.object({
  records: z
    .array(
      z
        .object({
          id: z.number().int().positive(),
          movieId: z.number().int().positive().nullable().optional(),
          title: z.string().max(2_000).nullable().optional(),
          status: z.string().max(100).optional().default('unknown'),
          trackedDownloadState: z.string().max(100).optional().default('unknown'),
          size: z.number().nonnegative().optional().default(0),
          sizeleft: z.number().nonnegative().optional().default(0),
          downloadId: z.string().max(500).nullable().optional(),
          errorMessage: z.string().max(1_000).nullable().optional(),
        })
        .passthrough(),
    )
    .max(1_000)
    .nullable()
    .optional(),
});

type RawRelease = z.output<typeof releaseSchema>;

export interface RadarrClientOptions {
  baseUrl: string;
  apiKey: string;
  qualityProfileId?: number | null;
  rootFolderPath?: string | null;
  tagIds?: number[];
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const normalizedBaseUrl = (value: string) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('RADARR_URL must be an HTTP(S) URL without embedded credentials.');
  }
  if (url.search || url.hash) throw new Error('RADARR_URL cannot contain a query or fragment.');
  return url.href.replace(/\/+$/, '');
};

const movieLookup = (movie: z.output<typeof movieSchema>, exists: boolean): ArrMovieLookup => ({
  exists,
  movieId: movie.id ?? null,
  title: movie.title ?? null,
  monitored: movie.monitored,
  hasFile: Boolean(movie.hasFile),
  movieFileId: movie.movieFileId || null,
});

const releaseDetails = (title: string) => {
  const videoCodec = /(?:x|h)265|hevc/i.test(title)
    ? 'x265 / HEVC'
    : /(?:x|h)264|avc/i.test(title)
      ? 'x264 / AVC'
      : 'No indicado';
  const audioCodec =
    title.match(/(?:truehd|atmos|dts[- .]?(?:hd|x)?|eac3|ddp|ac3|aac)(?:[ .]?[257]\.1)?/i)?.[0] ??
    'No indicado';
  return { videoCodec, audioCodec };
};

const scoreRelease = (release: RawRelease) => {
  const reasons: ReleaseCandidate['scoreReasons'] = [];
  const title = release.title ?? '';
  const resolution = release.quality.quality.resolution ?? 0;
  if (resolution === 1080) reasons.push({ points: 25, label: 'Resolución 1080p' });
  else if (resolution >= 2160) reasons.push({ points: 12, label: 'Resolución 4K' });
  else if (resolution && resolution <= 720)
    reasons.push({ points: -10, label: 'Resolución inferior a 1080p' });
  if (/(?:x|h)265|hevc/i.test(title)) reasons.push({ points: 15, label: 'Códec x265 eficiente' });
  if (release.size <= 6_000_000_000) reasons.push({ points: 20, label: 'Menos de 6 GB' });
  else if (release.size > 12_000_000_000)
    reasons.push({ points: -20, label: 'Tamaño muy por encima de 6 GB' });
  const seeders = release.seeders ?? 0;
  if (seeders >= 20) reasons.push({ points: 18, label: 'Seeds anunciados saludables' });
  else if (seeders >= 5) reasons.push({ points: 8, label: 'Seeds anunciados moderados' });
  else reasons.push({ points: -10, label: 'Pocos seeds anunciados' });
  if (release.customFormatScore) {
    reasons.push({
      points: Math.max(-50, Math.min(50, release.customFormatScore)),
      label: 'Custom Formats de Radarr',
    });
  }
  if (release.rejected || release.rejections?.length) {
    reasons.push({ points: -20, label: 'Radarr reporta rechazos' });
  }
  return { score: reasons.reduce((total, reason) => total + reason.points, 0), reasons };
};

export class RadarrHttpError extends Error {
  constructor(
    public readonly status: number,
    operation: string,
  ) {
    super(`Radarr respondió ${status} durante ${operation}.`);
    this.name = 'RadarrHttpError';
  }
}

export class RadarrClientV3 implements RadarrClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly releases = new Map<string, RawRelease>();

  constructor(private readonly options: RadarrClientOptions) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
    if (options.apiKey.trim().length < 8) throw new Error('RADARR_API_KEY is invalid.');
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.fetcher = options.fetch ?? fetch;
  }

  async health(): Promise<HealthCheck> {
    try {
      const [configuration, healthIssues] = await Promise.all([
        this.configuration(),
        this.get('health', z.array(healthIssueSchema).max(100)),
      ]);
      const important = healthIssues.filter((issue) =>
        ['warning', 'error'].includes(issue.type.toLowerCase()),
      );
      const messages = [
        ...configuration.issues,
        ...important.map((issue) => issue.message ?? issue.type),
      ];
      return {
        name: 'Radarr',
        status: messages.length ? 'degraded' : 'healthy',
        message: messages.length
          ? messages.join(' · ').slice(0, 300)
          : `Conectado · v${configuration.version ?? 'desconocida'}`,
      };
    } catch (error) {
      return {
        name: 'Radarr',
        status: 'offline',
        message: error instanceof Error ? error.message : 'Radarr no respondió.',
      };
    }
  }

  async configuration(): Promise<ArrConfiguration> {
    const [system, profiles, roots] = await Promise.all([
      this.get('system/status', systemSchema),
      this.get('qualityprofile', z.array(qualityProfileSchema).max(500)),
      this.get('rootfolder', z.array(rootFolderSchema).max(500)),
    ]);
    const qualityProfiles = profiles.map((profile) => ({
      id: profile.id,
      name: profile.name ?? `Perfil ${profile.id}`,
    }));
    const rootFolders = roots.map((root) => ({
      id: root.id,
      path: root.path ?? '',
      accessible: root.accessible,
      freeSpace: root.freeSpace ?? null,
    }));
    const issues: string[] = [];
    if (!this.options.qualityProfileId) issues.push('Falta RADARR_QUALITY_PROFILE_ID.');
    else if (!qualityProfiles.some((profile) => profile.id === this.options.qualityProfileId))
      issues.push('El perfil de calidad configurado no existe.');
    if (!this.options.rootFolderPath) issues.push('Falta RADARR_ROOT_FOLDER_PATH.');
    else {
      const selectedRoot = rootFolders.find((root) => root.path === this.options.rootFolderPath);
      if (!selectedRoot) issues.push('La carpeta raíz configurada no existe.');
      else if (!selectedRoot.accessible)
        issues.push('La carpeta raíz no está accesible para Radarr.');
    }
    return {
      mode: 'radarr',
      configured: issues.length === 0,
      version: system.version ?? null,
      qualityProfiles,
      rootFolders,
      selectedQualityProfileId: this.options.qualityProfileId ?? null,
      selectedRootFolderPath: this.options.rootFolderPath ?? null,
      issues,
    };
  }

  async lookup(tmdbId: number): Promise<ArrMovieLookup> {
    const movies = await this.get(
      `movie?tmdbId=${encodeURIComponent(tmdbId)}`,
      z.array(movieSchema).max(1_000),
    );
    const movie = movies.find((candidate) => candidate.tmdbId === tmdbId);
    return movie
      ? movieLookup(movie, true)
      : {
          exists: false,
          movieId: null,
          title: null,
          monitored: false,
          hasFile: false,
          movieFileId: null,
        };
  }

  async add(request: MediaRequest): Promise<ArrMovieLookup> {
    if (request.media.type !== 'movie') throw new Error('Radarr only accepts movie requests.');
    const existing = await this.lookup(request.media.tmdbId);
    if (existing.exists) return existing;
    const configuration = await this.configuration();
    if (!configuration.configured) throw new Error(configuration.issues.join(' '));
    const remote = await this.get(
      `movie/lookup/tmdb?tmdbId=${encodeURIComponent(request.media.tmdbId)}`,
      movieSchema,
    );
    const created = await this.request(
      'movie',
      movieSchema,
      {
        method: 'POST',
        body: JSON.stringify({
          ...remote,
          qualityProfileId: configuration.selectedQualityProfileId,
          rootFolderPath: configuration.selectedRootFolderPath,
          monitored: true,
          minimumAvailability: 'released',
          tags: this.options.tagIds ?? [],
          addOptions: { monitor: 'movieOnly', searchForMovie: false, addMethod: 'manual' },
        }),
      },
      'alta de película',
    );
    return movieLookup(created, true);
  }

  async searchReleases(request: MediaRequest): Promise<ReleaseCandidate[]> {
    if (request.media.type !== 'movie') throw new Error('Radarr only accepts movie requests.');
    const movie = await this.lookup(request.media.tmdbId);
    if (!movie.exists || !movie.movieId)
      throw new Error('La película todavía no existe en Radarr.');
    const releases = await this.get(
      `release?movieId=${encodeURIComponent(movie.movieId)}`,
      z.array(releaseSchema).max(1_000),
      'búsqueda interactiva',
    );
    return releases.slice(0, 200).map((release) => {
      const identity = `${request.id}:${release.guid ?? release.id ?? release.title}:${release.indexerId ?? 0}`;
      const id = createHash('sha256').update(identity).digest('hex');
      this.releases.set(id, release);
      const quality = release.quality.quality;
      const resolution = quality.resolution ?? 0;
      const details = releaseDetails(release.title ?? 'Release sin nombre');
      const scoring = scoreRelease(release);
      return {
        id,
        requestId: request.id,
        title: release.title ?? 'Release sin nombre',
        coverage: 'Película completa',
        quality: quality.name ?? 'Calidad no indicada',
        resolution: resolution >= 2160 ? '2160p' : resolution >= 1080 ? '1080p' : '720p',
        source:
          typeof quality.source === 'string' ? quality.source : (quality.name ?? 'No indicada'),
        videoCodec: details.videoCodec,
        audioCodec: details.audioCodec,
        sizeBytes: release.size,
        indexer: release.indexer ?? 'Indexador no indicado',
        seeds: release.seeders ?? 0,
        leechers: release.leechers ?? 0,
        languages: (release.languages ?? [])
          .map((language) => language.name)
          .filter((name): name is string => Boolean(name)),
        isRepack: /\b(?:repack|proper)\b/i.test(release.title ?? ''),
        rejections: release.rejections ?? [],
        customFormats: (release.customFormats ?? [])
          .map((format) => format.name)
          .filter((name): name is string => Boolean(name)),
        ageHours: release.ageHours,
        score: scoring.score,
        scoreReasons: scoring.reasons,
      };
    });
  }

  async grab(release: ReleaseCandidate): Promise<{ downloadId: string }> {
    const raw = this.releases.get(release.id);
    if (!raw) throw new Error('La búsqueda expiró; actualiza los resultados antes de elegir.');
    await this.request(
      'release',
      z.unknown(),
      { method: 'POST', body: JSON.stringify(raw) },
      'grab',
    );
    this.releases.delete(release.id);
    return { downloadId: raw.infoHash ?? raw.guid ?? release.id };
  }

  async queue(tmdbId: number): Promise<ArrQueueStatus | null> {
    const movie = await this.lookup(tmdbId);
    if (!movie.movieId) return null;
    const queue = await this.get(
      `queue?page=1&pageSize=20&movieIds=${encodeURIComponent(movie.movieId)}`,
      queueSchema,
      'consulta de cola',
    );
    const entry = queue.records?.find((candidate) => candidate.movieId === movie.movieId);
    if (!entry) return null;
    const progress =
      entry.size > 0 ? Math.round(((entry.size - entry.sizeleft) / entry.size) * 100) : 0;
    return {
      queueId: entry.id,
      movieId: movie.movieId,
      title: entry.title ?? movie.title ?? 'Película',
      status: entry.status,
      trackedState: entry.trackedDownloadState,
      progress: Math.max(0, Math.min(100, progress)),
      downloadId: entry.downloadId ?? null,
      errorMessage: entry.errorMessage ?? null,
    };
  }

  private get<Schema extends z.ZodTypeAny>(
    path: string,
    schema: Schema,
    operation = 'consulta',
  ): Promise<z.output<Schema>> {
    return this.request(path, schema, undefined, operation);
  }

  private async request<Schema extends z.ZodTypeAny>(
    path: string,
    schema: Schema,
    init: RequestInit = {},
    operation = 'consulta',
  ): Promise<z.output<Schema>> {
    const response = await this.fetcher(`${this.baseUrl}/api/v3/${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': this.options.apiKey,
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new RadarrHttpError(response.status, operation);
    const text = await response.text();
    let payload: unknown = undefined;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw new Error(`Radarr devolvió JSON inválido durante ${operation}.`);
      }
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new Error(`Radarr devolvió datos inválidos durante ${operation}.`);
    return parsed.data;
  }
}
