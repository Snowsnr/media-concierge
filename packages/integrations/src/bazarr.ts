import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  HealthCheck,
  MediaRequest,
  SubtitleCandidate,
  SubtitleConfiguration,
} from '@media-concierge/shared';
import type { SubtitleClient, SubtitleTarget } from './contracts.js';

const statusSchema = z.object({
  data: z.object({ bazarr_version: z.string().max(100).nullable().optional() }).passthrough(),
});

const savedSubtitleSchema = z
  .object({
    code2: z.string().max(20).nullable().optional(),
    code3: z.string().max(20).nullable().optional(),
    name: z.string().max(200).nullable().optional(),
    path: z.string().max(4_000).nullable().optional(),
    forced: z.boolean().nullable().optional().default(false),
    hi: z.boolean().nullable().optional().default(false),
  })
  .passthrough();

const movieSchema = z
  .object({
    radarrId: z.number().int().positive(),
    profileId: z.number().int().positive().nullable().optional(),
    subtitles: z.array(savedSubtitleSchema).max(500).nullable().optional(),
  })
  .passthrough();

const moviesSchema = z.object({
  data: z.union([z.array(movieSchema).max(10), movieSchema, z.null()]).optional(),
  total: z.number().int().nonnegative().optional(),
});

const booleanLikeSchema = z
  .union([
    z.boolean(),
    z.enum(['True', 'False', 'true', 'false', '1', '0']),
    z.literal(1),
    z.literal(0),
  ])
  .nullable()
  .optional();

const stringListSchema = z.array(z.string().max(2_000)).max(200).nullable().optional();

const manualResultSchema = z
  .object({
    dont_matches: stringListSchema,
    forced: booleanLikeSchema,
    hearing_impaired: booleanLikeSchema,
    language: z.string().max(200).nullable().optional(),
    matches: stringListSchema,
    original_format: booleanLikeSchema,
    provider: z.string().max(200).nullable().optional(),
    release_info: stringListSchema,
    score: z.number().finite().min(-1_000).max(1_000).optional().default(0),
    subtitle: z.string().min(1).max(20_000),
    uploader: z.string().max(500).nullable().optional(),
  })
  .passthrough();

const manualSearchSchema = z.object({ data: z.array(manualResultSchema).max(500) });
type ManualResult = z.output<typeof manualResultSchema>;

interface StoredChoice {
  target: SubtitleTarget;
  result: ManualResult;
  candidate: SubtitleCandidate;
}

export interface BazarrClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  confirmationTimeoutMs?: number;
  confirmationPollIntervalMs?: number;
  fetch?: typeof fetch;
}

const normalizedBaseUrl = (value: string) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('BAZARR_URL must be an HTTP(S) URL without embedded credentials.');
  }
  if (url.search || url.hash) throw new Error('BAZARR_URL cannot contain a query or fragment.');
  return url.href.replace(/\/+$/, '');
};

const booleanLike = (value: z.output<typeof booleanLikeSchema>) =>
  value === true || value === 1 || value === '1' || value === 'True' || value === 'true';

const matchLabels: Record<string, string> = {
  title: 'Título',
  series: 'Serie',
  year: 'Año',
  season: 'Temporada',
  episode: 'Episodio',
  release_group: 'Grupo de release',
  source: 'Fuente',
  resolution: 'Resolución',
  video_codec: 'Códec de video',
  audio_codec: 'Códec de audio',
  streaming_service: 'Servicio de streaming',
  edition: 'Edición',
  hash: 'Hash del archivo',
  hearing_impaired: 'Audición asistida',
};

const matchLabel = (value: string) =>
  matchLabels[value.toLowerCase()] ?? value.replaceAll('_', ' ');

const normalizedLanguage = (value: string | null | undefined) =>
  (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLocaleLowerCase('en-US');

const canonicalLanguage = (value: string | null | undefined) => {
  const normalized = normalizedLanguage(value);
  if (!normalized) return '';
  if (
    normalized === 'ea' ||
    (normalized.includes('spanish') &&
      (normalized.includes('latin') || normalized.includes('latino')))
  ) {
    return 'spanish-latin-america';
  }
  if (normalized === 'es' || normalized === 'spa' || normalized === 'spanish') return 'spanish';
  return normalized;
};

export class BazarrHttpError extends Error {
  constructor(
    public readonly status: number,
    operation: string,
  ) {
    super(`Bazarr respondió ${status} durante ${operation}.`);
    this.name = 'BazarrHttpError';
  }
}

export class BazarrClientV1 implements SubtitleClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly statusTimeoutMs: number;
  private readonly confirmationTimeoutMs: number;
  private readonly confirmationPollIntervalMs: number;
  private readonly fetcher: typeof fetch;
  private readonly choices = new Map<string, Map<string, StoredChoice>>();

  constructor(private readonly options: BazarrClientOptions) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
    const apiKey = options.apiKey.trim();
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(apiKey)) throw new Error('BAZARR_API_KEY is invalid.');
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.statusTimeoutMs = Math.min(this.timeoutMs, 15_000);
    this.confirmationTimeoutMs = Math.max(0, options.confirmationTimeoutMs ?? 30_000);
    this.confirmationPollIntervalMs = Math.max(1, options.confirmationPollIntervalMs ?? 750);
    this.fetcher = options.fetch ?? fetch;
  }

  async health(): Promise<HealthCheck> {
    try {
      const configuration = await this.configuration();
      return {
        name: 'Bazarr',
        status: configuration.issues.length ? 'degraded' : 'healthy',
        message: `Conectado · ${this.versionLabel(configuration.version)} · búsqueda manual`,
      };
    } catch (error) {
      return {
        name: 'Bazarr',
        status: 'offline',
        message: error instanceof Error ? error.message : 'Bazarr no respondió.',
      };
    }
  }

  async configuration(): Promise<SubtitleConfiguration> {
    const status = await this.json(
      'system/status',
      statusSchema,
      'consulta de versión',
      this.statusTimeoutMs,
    );
    return {
      mode: 'bazarr',
      configured: true,
      version: status.data.bazarr_version ?? null,
      authMode: 'api-key',
      manualSelection: true,
      issues: [],
    };
  }

  async isRecognized(target: SubtitleTarget): Promise<boolean> {
    return Boolean(await this.movie(target));
  }

  async search(request: MediaRequest, target?: SubtitleTarget): Promise<SubtitleCandidate[]> {
    const movieTarget = this.requiredMovieTarget(target);
    if (request.media.type !== 'movie') throw new Error('Bazarr Phase 6 only accepts movies.');
    const movie = await this.movie(movieTarget);
    if (!movie) {
      throw new Error('Bazarr todavía no reconoce esta película de Radarr.');
    }
    if (!movie.profileId) {
      throw new Error('Asigna un perfil de idioma a esta película dentro de Bazarr.');
    }
    const query = new URLSearchParams({ radarrid: String(movieTarget.externalId) });
    const response = await this.json(
      `providers/movies?${query.toString()}`,
      manualSearchSchema,
      'búsqueda manual de subtítulos',
    );
    const stored = new Map<string, StoredChoice>();
    const duplicates = new Map<string, number>();
    const candidates = response.data.map<SubtitleCandidate>((result) => {
      const stableIdentity = JSON.stringify([
        request.id,
        movieTarget.externalId,
        result.provider,
        result.language,
        result.score,
        result.release_info,
        result.forced,
        result.hearing_impaired,
        result.uploader,
      ]);
      const occurrence = duplicates.get(stableIdentity) ?? 0;
      duplicates.set(stableIdentity, occurrence + 1);
      const id = createHash('sha256').update(`${stableIdentity}:${occurrence}`).digest('hex');
      const candidate: SubtitleCandidate = {
        id,
        requestId: request.id,
        language: result.language?.trim() || 'Idioma no indicado',
        provider: result.provider?.trim() || 'Proveedor no indicado',
        score: Math.max(0, Math.min(100, Math.round(result.score))),
        release:
          (result.release_info ?? [])
            .map((value) => value.trim())
            .filter(Boolean)
            .join(' · ')
            .slice(0, 1_000) || 'Release no indicado',
        matches: [...new Set((result.matches ?? []).map(matchLabel))],
        mismatches: [...new Set((result.dont_matches ?? []).map(matchLabel))],
        hearingImpaired: booleanLike(result.hearing_impaired),
        forced: booleanLike(result.forced),
        uploader: result.uploader?.trim() || 'No indicado',
      };
      stored.set(id, { target: movieTarget, result, candidate });
      return candidate;
    });
    this.choices.set(request.id, stored);
    return candidates.sort((left, right) => right.score - left.score);
  }

  async download(
    request: MediaRequest,
    target: SubtitleTarget | undefined,
    candidateId: string,
  ): Promise<SubtitleCandidate> {
    const movieTarget = this.requiredMovieTarget(target);
    const choice = this.choices.get(request.id)?.get(candidateId);
    if (
      !choice ||
      choice.target.kind !== movieTarget.kind ||
      choice.target.externalId !== movieTarget.externalId
    ) {
      throw new Error('La búsqueda de Bazarr expiró; actualiza los resultados antes de elegir.');
    }
    const form = new URLSearchParams({
      radarrid: String(movieTarget.externalId),
      hi: String(booleanLike(choice.result.hearing_impaired)),
      forced: String(booleanLike(choice.result.forced)),
      original_format: String(booleanLike(choice.result.original_format)),
      provider: choice.result.provider ?? '',
      subtitle: choice.result.subtitle,
    });
    await this.request(
      'providers/movies',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      },
      'descarga manual de subtítulo',
    );
    const deadline = Date.now() + this.confirmationTimeoutMs;
    const expectedLanguage = canonicalLanguage(choice.result.language);
    const expectedForced = booleanLike(choice.result.forced);
    const expectedHi = booleanLike(choice.result.hearing_impaired);
    let saved = false;
    do {
      const movie = await this.movie(movieTarget);
      saved = Boolean(
        movie?.subtitles?.some((subtitle) => {
          const savedLanguages = [subtitle.name, subtitle.code2, subtitle.code3]
            .map(canonicalLanguage)
            .filter(Boolean);
          return Boolean(
            subtitle.path &&
            expectedLanguage &&
            savedLanguages.includes(expectedLanguage) &&
            Boolean(subtitle.forced) === expectedForced &&
            Boolean(subtitle.hi) === expectedHi,
          );
        }),
      );
      if (saved || Date.now() >= deadline) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(this.confirmationPollIntervalMs, deadline - Date.now())),
      );
    } while (Date.now() <= deadline);
    if (!saved) {
      throw new Error(
        'Bazarr aceptó la descarga, pero el archivo todavía no aparece en su índice. Reintenta la comprobación.',
      );
    }
    this.choices.delete(request.id);
    return choice.candidate;
  }

  private requiredMovieTarget(target?: SubtitleTarget): SubtitleTarget {
    if (
      !target ||
      target.kind !== 'movie' ||
      !Number.isInteger(target.externalId) ||
      target.externalId <= 0
    ) {
      throw new Error('Bazarr requiere un ID válido de película de Radarr.');
    }
    return target;
  }

  private versionLabel(version: string | null) {
    if (!version) return 'versión desconocida';
    return version.toLowerCase().startsWith('v') ? version : `v${version}`;
  }

  private async movie(target: SubtitleTarget) {
    const movieTarget = this.requiredMovieTarget(target);
    const query = new URLSearchParams({
      'radarrid[]': String(movieTarget.externalId),
      length: '1',
    });
    const response = await this.json(
      `movies?${query.toString()}`,
      moviesSchema,
      'sincronización de película',
      this.statusTimeoutMs,
    );
    const movies = Array.isArray(response.data)
      ? response.data
      : response.data
        ? [response.data]
        : [];
    return movies.find((movie) => movie.radarrId === movieTarget.externalId) ?? null;
  }

  private async json<Schema extends z.ZodTypeAny>(
    path: string,
    schema: Schema,
    operation: string,
    timeoutMs = this.timeoutMs,
  ): Promise<z.output<Schema>> {
    const response = await this.request(path, undefined, operation, timeoutMs);
    const text = await response.text();
    if (text.length > 5_000_000)
      throw new Error(`Bazarr devolvió demasiados datos durante ${operation}.`);
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Bazarr devolvió JSON inválido durante ${operation}.`);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new Error(`Bazarr devolvió datos inválidos durante ${operation}.`);
    return parsed.data;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    operation: string,
    timeoutMs = this.timeoutMs,
  ): Promise<Response> {
    const response = await this.fetcher(`${this.baseUrl}/api/${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'X-API-KEY': this.options.apiKey.trim(),
        ...init.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new BazarrHttpError(response.status, operation);
    return response;
  }
}
