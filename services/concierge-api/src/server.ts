import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  BazarrClientV1,
  BazarrHttpError,
  MockArrClient,
  MockMediaServerClient,
  MockMetadataProvider,
  MockPublicBroker,
  MockPushProvider,
  MockSubtitleClient,
  MockTorrentClient,
  QBittorrentClientV2,
  QBittorrentHttpError,
  RadarrClientV3,
  RadarrHttpError,
  SupabasePublicRequestBroker,
  type RadarrClient,
  type SubtitleClient,
  type SubtitleTarget,
  type TorrentClient,
} from '@media-concierge/integrations';
import {
  adminDecisionSchema,
  canTransition,
  createRequestSchema,
  createInvitationSchema,
  downloadControlSchema,
  episodeActionSchema,
  mockScenarioSchema,
  subtitleSelectionSchema,
  toFamilyRequest,
  type CreatedInvitation,
  type AppNotification,
  type FamilyAccountSummary,
  type InvitationSummary,
  type NotificationConfig,
} from '@media-concierge/shared';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RequestRepository } from './database.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
const localOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];
const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: [...localOrigins, ...configuredOrigins],
  methods: ['GET', 'POST'],
});

const repository = new RequestRepository();
const metadata = new MockMetadataProvider();
const radarrConfigured = Boolean(process.env.RADARR_URL && process.env.RADARR_API_KEY);
const radarr: RadarrClient = radarrConfigured
  ? new RadarrClientV3({
      baseUrl: process.env.RADARR_URL!,
      apiKey: process.env.RADARR_API_KEY!,
      qualityProfileId: process.env.RADARR_QUALITY_PROFILE_ID
        ? Number(process.env.RADARR_QUALITY_PROFILE_ID)
        : null,
      rootFolderPath: process.env.RADARR_ROOT_FOLDER_PATH ?? null,
      tagIds: (process.env.RADARR_TAG_IDS ?? '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    })
  : new MockArrClient('Radarr');
const sonarr = new MockArrClient('Sonarr');
const qbittorrentConfigured = Boolean(
  process.env.QBITTORRENT_URL &&
  (process.env.QBITTORRENT_API_KEY ||
    (process.env.QBITTORRENT_USERNAME && process.env.QBITTORRENT_PASSWORD)),
);
const mockTorrent = new MockTorrentClient();
const torrent: TorrentClient = qbittorrentConfigured
  ? new QBittorrentClientV2({
      baseUrl: process.env.QBITTORRENT_URL!,
      apiKey: process.env.QBITTORRENT_API_KEY,
      username: process.env.QBITTORRENT_USERNAME,
      password: process.env.QBITTORRENT_PASSWORD,
    })
  : mockTorrent;
const bazarrConfigured = Boolean(process.env.BAZARR_URL && process.env.BAZARR_API_KEY);
const mockSubtitles = new MockSubtitleClient();
const subtitles: SubtitleClient = bazarrConfigured
  ? new BazarrClientV1({
      baseUrl: process.env.BAZARR_URL!,
      apiKey: process.env.BAZARR_API_KEY!,
    })
  : mockSubtitles;
const mediaServer = new MockMediaServerClient();
const brokerConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_BRIDGE_TOKEN);
const broker = brokerConfigured
  ? new SupabasePublicRequestBroker({
      supabaseUrl: process.env.SUPABASE_URL!,
      bridgeToken: process.env.SUPABASE_BRIDGE_TOKEN!,
    })
  : new MockPublicBroker();
const push = new MockPushProvider();
const arrFor = (item: NonNullable<ReturnType<RequestRepository['get']>>) =>
  item.media.type === 'movie' ? radarr : sonarr;

const publishPublicStatus = async <T extends ReturnType<RequestRepository['get']>>(item: T) => {
  if (item) {
    try {
      await broker.publishStatus(item);
    } catch (error) {
      app.log.warn(
        { err: { message: error instanceof Error ? error.message : 'Broker publish failed' } },
        'Immediate public status publish failed; periodic sync will retry',
      );
    }
  }
  return item;
};

const requestParams = z.object({ id: z.string().uuid() });
const selectionBody = z.object({ candidateId: z.string().min(1).max(200) });
const existingSubtitleConfirmationBody = z.object({ confirmed: z.literal(true) });
const episodeParams = z.object({ id: z.string().uuid(), episodeId: z.string().uuid() });
const resetFamilyPasswordBody = z.object({ password: z.string().min(10).max(72) });

const continueAfterImport = (
  id: string,
  note = 'Archivo importado. Esperando reconocimiento de Bazarr.',
) => {
  const current = repository.get(id);
  if (!current) throw new Error('Request not found');
  repository.setAllAiredEpisodeStates(id, 'IMPORTED');
  repository.transition(id, 'WAITING_FOR_BAZARR', 'system', note);
  if (bazarrConfigured && radarrConfigured && current.media.type === 'movie') {
    return repository.get(id)!;
  }
  repository.setAllAiredEpisodeStates(id, 'SUBTITLES_REQUIRED');
  return repository.transition(
    id,
    'SUBTITLES_REQUIRED',
    'system',
    'Subtítulos simulados listos para revisión manual.',
  );
};

const subtitleTargetFor = async (
  item: NonNullable<ReturnType<RequestRepository['get']>>,
): Promise<SubtitleTarget | undefined> => {
  if (!(bazarrConfigured && radarrConfigured && item.media.type === 'movie')) return undefined;
  const movie = await radarr.lookup(item.media.tmdbId);
  if (!movie.movieId) throw new Error('Radarr todavía no devolvió el ID requerido por Bazarr.');
  return { kind: 'movie', externalId: movie.movieId };
};

const refreshBazarrRequest = async (id: string) => {
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  if (item.state !== 'WAITING_FOR_BAZARR') {
    throw new Error(`Invalid Bazarr refresh while in ${item.state}`);
  }
  const target = await subtitleTargetFor(item);
  if (!target) {
    repository.setAllAiredEpisodeStates(id, 'SUBTITLES_REQUIRED');
    return repository.transition(
      id,
      'SUBTITLES_REQUIRED',
      'system',
      'Subtítulos simulados listos para revisión manual.',
    );
  }
  if (!(await subtitles.isRecognized(target))) return item;
  repository.setAllAiredEpisodeStates(id, 'SUBTITLES_REQUIRED');
  return repository.transition(
    id,
    'SUBTITLES_REQUIRED',
    'system',
    'Bazarr reconoció la película. Búsqueda manual disponible.',
  );
};

const completeSeriesIfReady = (id: string) => {
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  const complete = item.episodes
    .filter((episode) => episode.aired)
    .every((episode) => ['READY', 'READY_WITHOUT_SUBTITLES'].includes(episode.state));
  return complete
    ? repository.transition(
        id,
        'VERIFYING_JELLYFIN',
        'system',
        'Todos los episodios emitidos están listos para verificar.',
      )
    : item;
};

const refreshRadarrRequest = async (id: string) => {
  let item = repository.get(id);
  if (!item) throw new Error('Request not found');
  if (!radarrConfigured || item.media.type !== 'movie') return item;
  if (!['QUEUED', 'DOWNLOADING', 'PAUSED', 'STALLED', 'IMPORTING'].includes(item.state)) {
    throw new Error(`Invalid Radarr refresh while in ${item.state}`);
  }

  if (qbittorrentConfigured && item.downloadId) {
    try {
      const torrentStatus = await torrent.status(item.downloadId);
      if (torrentStatus) {
        item = repository.setTorrent(id, torrentStatus);
        item = repository.setProgress(id, torrentStatus.progress);
        if (
          torrentStatus.state === 'downloading' &&
          ['QUEUED', 'PAUSED', 'STALLED'].includes(item.state)
        ) {
          item = repository.transition(
            id,
            'DOWNLOADING',
            'system',
            'qBittorrent confirmó actividad de descarga.',
          );
        } else if (
          torrentStatus.state === 'stalled' &&
          ['QUEUED', 'DOWNLOADING'].includes(item.state)
        ) {
          item = repository.transition(
            id,
            'STALLED',
            'system',
            'qBittorrent reportó una descarga estancada.',
          );
        } else if (
          torrentStatus.state === 'paused' &&
          ['QUEUED', 'DOWNLOADING', 'STALLED'].includes(item.state)
        ) {
          item = repository.transition(
            id,
            'PAUSED',
            'system',
            'qBittorrent reportó la descarga pausada.',
          );
        } else if (
          torrentStatus.state === 'errored' &&
          ['QUEUED', 'DOWNLOADING', 'STALLED'].includes(item.state)
        ) {
          return repository.transition(
            id,
            'FAILED',
            'system',
            torrentStatus.errorMessage ?? 'qBittorrent reportó un error en la descarga.',
          );
        }
      }
    } catch (error) {
      app.log.warn(
        { err: { message: error instanceof Error ? error.message : 'Torrent status failed' } },
        'qBittorrent telemetry failed; Radarr polling continues',
      );
    }
  }

  const queue = await radarr.queue(item.media.tmdbId);
  if (queue) {
    if (queue.downloadId && queue.downloadId !== item.downloadId) {
      item = repository.setDownload(id, queue.downloadId);
    }
    item = repository.setProgress(id, queue.progress);
    if (item.state === 'QUEUED' && queue.status.toLowerCase() !== 'queued') {
      item = repository.transition(
        id,
        'DOWNLOADING',
        'system',
        'Radarr confirmó que la descarga comenzó.',
      );
    }
    if (
      ['QUEUED', 'DOWNLOADING'].includes(item.state) &&
      (['warning', 'failed'].some((value) => queue.trackedState.toLowerCase().includes(value)) ||
        queue.errorMessage)
    ) {
      return repository.transition(
        id,
        'STALLED',
        'system',
        queue.errorMessage ?? 'Radarr reportó que la descarga necesita atención.',
      );
    }
    return item;
  }

  const movie = await radarr.lookup(item.media.tmdbId);
  if (!movie.hasFile) {
    return item;
  }
  if (['QUEUED', 'PAUSED', 'STALLED'].includes(item.state)) {
    item = repository.transition(
      id,
      'DOWNLOADING',
      'system',
      'Radarr completó la descarga antes de la siguiente consulta.',
    );
  }
  if (item.state === 'DOWNLOADING') {
    repository.setProgress(id, 100);
    item = repository.transition(
      id,
      'IMPORTING',
      'system',
      'Radarr retiró el elemento de la cola y reportó un archivo de película.',
    );
  }
  return item.state === 'IMPORTING' ? continueAfterImport(id) : item;
};

app.get('/health', async () => ({
  status: 'ok',
  mode: brokerConfigured ? 'supabase-broker' : 'mock',
  radarr: radarrConfigured ? 'radarr' : 'mock',
  qbittorrent: qbittorrentConfigured ? 'qbittorrent' : 'mock',
  bazarr: bazarrConfigured ? 'bazarr' : 'mock',
  service: 'media-concierge-api',
}));

app.get('/api/integrations/health', async () =>
  Promise.all([
    metadata.health(),
    broker.health(),
    radarr.health(),
    sonarr.health(),
    torrent.health(),
    subtitles.health(),
    mediaServer.health(),
    push.health(),
  ]),
);

app.get('/api/catalog/search', async (request) => {
  const query = z.object({ q: z.string().max(100).default('') }).parse(request.query);
  return metadata.search(query.q);
});

app.get('/api/requests', async () => repository.list());

app.get('/api/public/requests', async (request) => {
  const query = z.object({ requesterName: z.string().trim().min(1).max(80) }).parse(request.query);
  return repository
    .list()
    .filter((item) => item.requesterName === query.requesterName)
    .map(toFamilyRequest);
});

app.get('/api/public/requests/:id', async (request, reply) => {
  const { id } = requestParams.parse(request.params);
  const query = z.object({ requesterName: z.string().trim().min(1).max(80) }).parse(request.query);
  const item = repository.get(id);
  if (!item || item.requesterName !== query.requesterName) {
    return reply.code(404).send({ message: 'Solicitud no encontrada.' });
  }
  return toFamilyRequest(item);
});

app.get('/api/requests/:id', async (request, reply) => {
  const { id } = requestParams.parse(request.params);
  const item = repository.get(id);
  return item ?? reply.code(404).send({ message: 'Solicitud no encontrada.' });
});

app.get('/api/integrations/radarr', async () => radarr.configuration());

app.get('/api/integrations/qbittorrent', async () => torrent.configuration());

app.get('/api/integrations/bazarr', async () => subtitles.configuration());

app.get('/api/requests/:id/radarr', async (request, reply) => {
  const { id } = requestParams.parse(request.params);
  const item = repository.get(id);
  if (!item) return reply.code(404).send({ message: 'Solicitud no encontrada.' });
  if (item.media.type !== 'movie') {
    return reply.code(409).send({ message: 'Esta solicitud no corresponde a Radarr.' });
  }
  const [configuration, movie, queue] = await Promise.all([
    radarr.configuration(),
    radarr.lookup(item.media.tmdbId),
    radarr.queue(item.media.tmdbId),
  ]);
  return { configuration, movie, queue };
});

app.post('/api/requests', async (request, reply) => {
  const input = createRequestSchema.parse(request.body);
  const item = repository.create(input);
  return reply.code(201).send(item);
});

app.post('/api/public/requests', async (request, reply) => {
  const input = createRequestSchema.parse(request.body);
  const item = repository.create(input);
  return reply.code(201).send(toFamilyRequest(item));
});

app.post('/api/requests/:id/decision', async (request) => {
  const { id } = requestParams.parse(request.params);
  const decision = adminDecisionSchema.parse(request.body);
  if (decision.action === 'reject') {
    return publishPublicStatus(
      repository.transition(id, 'REJECTED', 'admin', decision.note || 'Solicitud rechazada.'),
    );
  }
  if (decision.action === 'clarify') {
    return publishPublicStatus(
      repository.transition(
        id,
        'NEEDS_CLARIFICATION',
        'admin',
        decision.note || 'El administrador necesita más información.',
      ),
    );
  }
  const approved = repository.transition(
    id,
    'APPROVED',
    'admin',
    decision.note || 'Solicitud aprobada manualmente.',
  );
  await publishPublicStatus(approved);
  const adding = repository.transition(
    id,
    'ADDING_TO_ARR',
    'system',
    approved.media.type === 'movie' && radarrConfigured
      ? 'Preparando alta segura en Radarr sin búsqueda automática.'
      : 'Simulando alta segura en Radarr o Sonarr.',
  );
  try {
    const client = arrFor(adding);
    const existing = await client.lookup(adding.media.tmdbId);
    const prepared = existing.exists ? existing : await client.add(adding);
    if (prepared.hasFile) {
      return continueAfterImport(
        id,
        'Radarr ya contiene un archivo importado; esperando reconocimiento de Bazarr.',
      );
    }
    return repository.transition(
      id,
      'SELECTING_RELEASE',
      'system',
      approved.media.type === 'movie' && radarrConfigured
        ? 'Película preparada en Radarr. Esperando selección manual del administrador.'
        : 'Resultados listos. Esperando selección manual del administrador.',
    );
  } catch (error) {
    const failed = repository.transition(
      id,
      'FAILED',
      'system',
      error instanceof Error ? error.message : 'Radarr no pudo preparar la película.',
    );
    await publishPublicStatus(failed);
    return failed;
  }
});

app.get('/api/requests/:id/releases', async (request) => {
  const { id } = requestParams.parse(request.params);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  return arrFor(item).searchReleases(item);
});

app.post('/api/requests/:id/releases/select', async (request) => {
  const { id } = requestParams.parse(request.params);
  const { candidateId } = selectionBody.parse(request.body);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  const client = arrFor(item);
  const releases = await client.searchReleases(item);
  const selected = releases.find((release) => release.id === candidateId);
  if (!selected) throw new Error('Release not found');
  const grabbed = await client.grab(selected);
  repository.setRelease(id, selected.id);
  repository.setDownload(id, grabbed.downloadId);
  repository.setAllAiredEpisodeStates(id, 'QUEUED');
  repository.transition(
    id,
    'QUEUED',
    'admin',
    `Release seleccionado manualmente: ${selected.title}`,
  );
  if (item.media.type === 'movie' && radarrConfigured) {
    return repository.get(id)!;
  }
  return repository.transition(id, 'DOWNLOADING', 'system', 'Descarga simulada iniciada.');
});

app.post('/api/requests/:id/advance', async (request) => {
  const { id } = requestParams.parse(request.params);
  let item = repository.get(id);
  if (!item) throw new Error('Request not found');

  if (radarrConfigured && item.media.type === 'movie') {
    return refreshRadarrRequest(id);
  }

  if (item.state === 'DOWNLOADING') {
    if (item.mockScenario === 'stalled') {
      repository.setAllAiredEpisodeStates(id, 'DOWNLOADING');
      return repository.transition(
        id,
        'STALLED',
        'system',
        'Simulación: la descarga dejó de recibir datos.',
      );
    }
    if (item.mockScenario === 'download-error') {
      repository.setAllAiredEpisodeStates(id, 'FAILED');
      return publishPublicStatus(
        repository.transition(
          id,
          'FAILED',
          'system',
          'Simulación: el cliente reportó archivos faltantes.',
        ),
      );
    }
    item = repository.setProgress(id, item.progress + 25);
    if (item.progress < 100) return item;
    item = repository.transition(
      id,
      'IMPORTING',
      'system',
      'Descarga terminada; importación simulada detectada.',
    );
    if (item.mockScenario === 'import-delay') {
      return repository.recordEvent(
        id,
        'system',
        'Simulación: Radarr/Sonarr todavía está procesando la importación.',
      );
    }
    return continueAfterImport(id);
  }
  throw new Error(`Cannot advance request while in ${item.state}`);
});

app.post('/api/requests/:id/radarr/refresh', async (request) => {
  const { id } = requestParams.parse(request.params);
  return refreshRadarrRequest(id);
});

app.post('/api/requests/:id/bazarr/refresh', async (request) => {
  const { id } = requestParams.parse(request.params);
  return refreshBazarrRequest(id);
});

app.get('/api/requests/:id/subtitles', async (request) => {
  const { id } = requestParams.parse(request.params);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  if (item.state !== 'SUBTITLES_REQUIRED') {
    throw new Error(`Invalid subtitle search while in ${item.state}`);
  }
  const target = await subtitleTargetFor(item);
  return item.mockScenario === 'no-subtitles' ? [] : subtitles.search(item, target);
});

app.post('/api/requests/:id/subtitles/select', async (request) => {
  const { id } = requestParams.parse(request.params);
  const { candidateId, episodeId } = subtitleSelectionSchema.parse(request.body);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  if (item.state !== 'SUBTITLES_REQUIRED') {
    throw new Error(`Invalid subtitle selection while in ${item.state}`);
  }
  const target = await subtitleTargetFor(item);
  const selected = await subtitles.download(item, target, candidateId);
  if (item.media.type === 'series') {
    if (!episodeId) throw new Error('Episode id is required for a series');
    repository.setEpisodeState(id, episodeId, 'READY', selected.id);
    repository.recordEvent(
      id,
      'admin',
      `Subtítulo seleccionado manualmente para un episodio: ${selected.language} · ${selected.provider}`,
    );
    return completeSeriesIfReady(id);
  }
  repository.setSubtitle(id, selected.id);
  return repository.transition(
    id,
    'VERIFYING_JELLYFIN',
    'admin',
    `Subtítulo seleccionado manualmente: ${selected.language} · ${selected.provider}`,
  );
});

app.post('/api/requests/:id/subtitles/confirm-existing', async (request) => {
  const { id } = requestParams.parse(request.params);
  existingSubtitleConfirmationBody.parse(request.body);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  if (item.media.type !== 'movie') {
    throw new Error('Existing subtitle confirmation is only available for movies');
  }
  if (item.state !== 'SUBTITLES_REQUIRED') {
    throw new Error(`Invalid existing subtitle confirmation while in ${item.state}`);
  }
  repository.setSubtitle(id, 'manual-confirmed-existing');
  return repository.transition(
    id,
    'VERIFYING_JELLYFIN',
    'admin',
    'El administrador confirmó que el archivo ya incluye subtítulos; Bazarr no realizó una descarga.',
  );
});

app.post('/api/requests/:id/subtitles/retry', async (request) => {
  const { id } = requestParams.parse(request.params);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  if (item.state !== 'SUBTITLES_REQUIRED') {
    throw new Error(`Invalid subtitle retry while in ${item.state}`);
  }
  if (!bazarrConfigured) repository.setScenario(id, 'none', 'system');
  return repository.recordEvent(
    id,
    'admin',
    'Búsqueda manual de subtítulos solicitada nuevamente.',
  );
});

app.post('/api/requests/:id/subtitles/reopen', async (request) => {
  const { id } = requestParams.parse(request.params);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  if (item.state !== 'VERIFYING_JELLYFIN') {
    throw new Error(`Invalid subtitle replacement while in ${item.state}`);
  }
  repository.setSubtitle(id, null);
  return repository.transition(
    id,
    'SUBTITLES_REQUIRED',
    'admin',
    'Reemplazo manual de subtítulo solicitado.',
  );
});

app.post('/api/requests/:id/verify', async (request) => {
  const { id } = requestParams.parse(request.params);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  if (item.mockScenario === 'jellyfin-delay') {
    repository.setScenario(id, 'none', 'system');
    return repository.recordEvent(
      id,
      'system',
      'Jellyfin todavía no muestra el contenido; se podrá reintentar sin reiniciarlo.',
    );
  }
  const available = await mediaServer.isAvailable(item);
  if (!available) return item;
  return publishPublicStatus(
    repository.transition(id, 'READY', 'system', 'Disponibilidad simulada confirmada en Jellyfin.'),
  );
});

app.post('/api/requests/:id/scenario', async (request) => {
  const { id } = requestParams.parse(request.params);
  const { scenario } = mockScenarioSchema.parse(request.body);
  return repository.setScenario(id, scenario);
});

app.post('/api/requests/:id/download/control', async (request) => {
  const { id } = requestParams.parse(request.params);
  const control = downloadControlSchema.parse(request.body);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  const liveTorrentMode = qbittorrentConfigured && radarrConfigured && item.media.type === 'movie';
  const liveTorrent = liveTorrentMode ? item.downloadId : null;
  const requireTransition = (nextState: Parameters<typeof canTransition>[1]) => {
    if (!canTransition(item.state, nextState)) {
      throw new Error(`Invalid download control while in ${item.state}`);
    }
  };
  const requireLiveHash = () => {
    if (liveTorrentMode && !liveTorrent) {
      throw new Error('La solicitud todavía no tiene un hash de qBittorrent verificable.');
    }
  };

  if (control.action === 'pause') {
    requireTransition('PAUSED');
    requireLiveHash();
    if (liveTorrent) await torrent.pause(liveTorrent);
    repository.setAllAiredEpisodeStates(id, 'PAUSED');
    return repository.transition(
      id,
      'PAUSED',
      'admin',
      liveTorrent
        ? 'Descarga pausada manualmente en qBittorrent.'
        : 'Descarga pausada manualmente.',
    );
  }
  if (control.action === 'resume') {
    requireTransition('DOWNLOADING');
    requireLiveHash();
    if (liveTorrent) await torrent.resume(liveTorrent);
    repository.setScenario(id, 'none', 'admin');
    repository.setAllAiredEpisodeStates(id, 'DOWNLOADING');
    return repository.transition(
      id,
      'DOWNLOADING',
      'admin',
      liveTorrent
        ? 'Descarga reanudada manualmente en qBittorrent.'
        : 'Descarga reanudada manualmente.',
    );
  }
  if (control.action === 'reannounce') {
    if (!['QUEUED', 'DOWNLOADING', 'PAUSED', 'STALLED'].includes(item.state)) {
      throw new Error(`Invalid reannounce while in ${item.state}`);
    }
    requireLiveHash();
    if (liveTorrent) await torrent.reannounce(liveTorrent);
    else await mockTorrent.reannounce(`mock-${item.selectedReleaseId ?? 'unknown'}`);
    return repository.recordEvent(
      id,
      'admin',
      liveTorrent
        ? 'Reannounce solicitado a qBittorrent.'
        : 'Reannounce solicitado al adaptador simulado.',
    );
  }
  if (control.action === 'retry-release') {
    requireTransition('SELECTING_RELEASE');
    if (qbittorrentConfigured && radarrConfigured && item.media.type === 'movie') {
      const removed = await radarr.removeFromQueue(item.media.tmdbId, {
        removeFromClient: true,
        blocklist: true,
      });
      if (!removed) {
        throw new Error('Radarr ya no administra esta descarga; no se modificó qBittorrent.');
      }
    }
    repository.setScenario(id, 'none', 'admin');
    repository.clearDownload(id);
    return repository.transition(
      id,
      'SELECTING_RELEASE',
      'admin',
      'Release anterior abandonado de forma coordinada; regresando a la búsqueda.',
    );
  }
  requireTransition('CANCELLED');
  if (!control.deleteData) requireLiveHash();
  const deletion = control.deleteData
    ? qbittorrentConfigured
      ? ' Se solicitó el borrado del torrent y sus datos parciales.'
      : ' Se borrarían los datos parciales.'
    : ' Se conservaron los datos parciales.';
  const blocklist = control.blocklist ? ' El release se añadió a la blocklist.' : '';
  if (qbittorrentConfigured && radarrConfigured && item.media.type === 'movie') {
    if (!control.deleteData && item.downloadId) await torrent.pause(item.downloadId);
    const removed = await radarr.removeFromQueue(item.media.tmdbId, {
      removeFromClient: control.deleteData,
      blocklist: control.blocklist,
    });
    if (!removed) {
      throw new Error('Radarr ya no administra esta descarga; no se modificó qBittorrent.');
    }
  }
  return repository.transition(
    id,
    'CANCELLED',
    'admin',
    `Cancelación coordinada mediante Radarr/Sonarr.${deletion}${blocklist}`,
  );
});

app.post('/api/requests/:id/import/retry', async (request) => {
  const { id } = requestParams.parse(request.params);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  if (item.state !== 'IMPORTING' && item.state !== 'FAILED') {
    throw new Error(`Invalid import retry while in ${item.state}`);
  }
  repository.setScenario(id, 'none', 'admin');
  if (item.state === 'FAILED') {
    repository.transition(id, 'IMPORTING', 'admin', 'Reintentando importación manualmente.');
  } else {
    repository.recordEvent(id, 'admin', 'Reintentando consulta de importación.');
  }
  return continueAfterImport(id);
});

app.post('/api/requests/:id/episodes/:episodeId', async (request) => {
  const { id, episodeId } = episodeParams.parse(request.params);
  const { action } = episodeActionSchema.parse(request.body);
  if (action === 'retry-subtitles') {
    repository.setScenario(id, 'none', 'admin');
    repository.setEpisodeState(id, episodeId, 'SUBTITLES_REQUIRED');
    return repository.recordEvent(
      id,
      'admin',
      'Búsqueda de subtítulos reintentada para el episodio.',
    );
  }
  repository.setEpisodeState(id, episodeId, 'READY_WITHOUT_SUBTITLES');
  repository.recordEvent(id, 'admin', 'Episodio marcado manualmente como listo sin subtítulos.');
  return completeSeriesIfReady(id);
});

app.post('/api/demo/reset', async () => repository.reset());

const syncPublicBroker = async () => {
  if (!brokerConfigured) return { imported: 0, published: 0, mode: 'mock' as const };
  const pending = await broker.pullPending();
  let imported = 0;
  for (const publicRequest of pending) {
    let local = repository.create({
      publicRequestId: publicRequest.publicRequestId,
      media: publicRequest.media,
      requesterName: publicRequest.requesterName,
      note: publicRequest.note ?? '',
      scope: publicRequest.scope,
      idempotencyKey: publicRequest.publicRequestId,
    });
    if (local.state === 'REQUESTED') {
      local = repository.transition(
        local.id,
        'SYNCED_TO_HOMELAB',
        'system',
        'Solicitud sincronizada desde el buzón público.',
      );
      imported += 1;
    }
    await broker.publishStatus(local);
  }
  const linked = repository.list().filter((item) => item.publicRequestId);
  await Promise.all(linked.map((item) => broker.publishStatus(item)));
  return { imported, published: linked.length, mode: 'supabase' as const };
};

app.post('/api/broker/sync', async () => syncPublicBroker());

const edgeFunction = async <T>(name: string, body: unknown): Promise<T> => {
  if (!brokerConfigured) throw new Error('Supabase broker is not configured');
  const response = await fetch(
    `${process.env.SUPABASE_URL!.replace(/\/$/, '')}/functions/v1/${name}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bridge-token': process.env.SUPABASE_BRIDGE_TOKEN!,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6_000),
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `${name} service returned ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const invitationFunction = <T>(body: unknown) => edgeFunction<T>('invitations', body);
const notificationFunction = <T>(body: unknown) => edgeFunction<T>('notifications', body);

const mapInvitation = (row: Record<string, unknown>): InvitationSummary => ({
  id: String(row.id),
  label: String(row.label),
  expiresAt: String(row.expires_at),
  createdAt: String(row.created_at),
  redeemedAt: row.redeemed_at ? String(row.redeemed_at) : null,
  revokedAt: row.revoked_at ? String(row.revoked_at) : null,
});

const mapFamilyAccount = (row: Record<string, unknown>): FamilyAccountSummary => ({
  userId: String(row.user_id),
  displayName: String(row.display_name),
  username: row.username ? String(row.username) : null,
  createdAt: String(row.created_at),
  revokedAt: row.revoked_at ? String(row.revoked_at) : null,
});

app.get('/api/invitations', async () => {
  if (!brokerConfigured) return [];
  const rows = await invitationFunction<Record<string, unknown>[]>({ action: 'list' });
  return rows.map(mapInvitation);
});

app.post('/api/invitations', async (request, reply) => {
  const input = createInvitationSchema.parse(request.body);
  if (!brokerConfigured) {
    const now = new Date();
    const demo: CreatedInvitation = {
      id: randomUUID(),
      label: input.label,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000).toISOString(),
      redeemedAt: null,
      revokedAt: null,
      inviteUrl: `http://localhost:5173/#invite=demo-${randomUUID()}`,
    };
    return reply.code(201).send(demo);
  }
  const row = await invitationFunction<Record<string, unknown>>({ action: 'create', ...input });
  return reply
    .code(201)
    .send({ ...mapInvitation(row), inviteUrl: String(row.inviteUrl) } satisfies CreatedInvitation);
});

app.post('/api/invitations/:id/revoke', async (request) => {
  const { id } = requestParams.parse(request.params);
  if (!brokerConfigured) return { revoked: true, mode: 'mock' };
  return invitationFunction({ action: 'revoke', invitationId: id });
});

app.get('/api/family-accounts', async () => {
  if (!brokerConfigured) return [];
  const rows = await invitationFunction<Record<string, unknown>[]>({ action: 'members' });
  return rows.map(mapFamilyAccount);
});

app.post('/api/family-accounts/:id/reset-password', async (request) => {
  const { id } = requestParams.parse(request.params);
  const { password } = resetFamilyPasswordBody.parse(request.body);
  if (!brokerConfigured) return { reset: true, mode: 'mock' };
  return invitationFunction({ action: 'reset-password', userId: id, password });
});

app.get('/api/notifications/config', async () => {
  if (!brokerConfigured) return { enabled: false, publicKey: '' } satisfies NotificationConfig;
  return notificationFunction<NotificationConfig>({ action: 'config' });
});

app.get('/api/notifications', async () => {
  if (!brokerConfigured) return [] satisfies AppNotification[];
  return notificationFunction<AppNotification[]>({ action: 'admin-list' });
});

const pushSubscriptionBody = z.object({
  subscription: z.object({
    endpoint: z.string().url().startsWith('https://').max(2048),
    keys: z.object({
      p256dh: z.string().min(40).max(256),
      auth: z.string().min(16).max(128),
    }),
  }),
  userAgent: z.string().max(500).default(''),
});

app.post('/api/notifications/subscribe', async (request) => {
  if (!brokerConfigured) return { subscribed: false, mode: 'mock' };
  const input = pushSubscriptionBody.parse(request.body);
  return notificationFunction({ action: 'admin-subscribe', ...input });
});

app.post('/api/notifications/unsubscribe', async (request) => {
  if (!brokerConfigured) return { subscribed: false, mode: 'mock' };
  const input = z.object({ endpoint: z.string().url().max(2048) }).parse(request.body);
  return notificationFunction({ action: 'admin-unsubscribe', ...input });
});

app.post('/api/notifications/test', async () => {
  if (!brokerConfigured) return { queued: false, mode: 'mock' };
  return notificationFunction({ action: 'admin-test' });
});

app.post('/api/notifications/:id/read', async (request) => {
  const { id } = requestParams.parse(request.params);
  if (!brokerConfigured) return { read: true, mode: 'mock' };
  return notificationFunction({ action: 'admin-read', notificationId: id });
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ message: 'Datos inválidos.', issues: error.issues });
  }
  const message = error instanceof Error ? error.message : 'Unknown request error';
  const name = error instanceof Error ? error.name : 'UnknownError';
  const status =
    error instanceof RadarrHttpError ||
    error instanceof QBittorrentHttpError ||
    error instanceof BazarrHttpError
      ? 502
      : name === 'TimeoutError'
        ? 504
        : message.includes('not found')
          ? 404
          : message.startsWith('Invalid')
            ? 409
            : 400;
  app.log.warn({ err: { name, message } }, 'Request failed');
  return reply.code(status).send({ message });
});

let brokerTimer: ReturnType<typeof setInterval> | null = null;
app.addHook('onClose', async () => {
  if (brokerTimer) clearInterval(brokerTimer);
});

const port = Number(process.env.CONCIERGE_API_PORT ?? 4100);
await app.listen({ port, host: '0.0.0.0' });

if (brokerConfigured) {
  const intervalMs = Number(process.env.BROKER_POLL_INTERVAL_MS ?? 15_000);
  void syncPublicBroker().catch((error: unknown) => {
    app.log.warn(
      { err: { message: error instanceof Error ? error.message : 'Broker sync failed' } },
      'Initial public broker sync failed',
    );
  });
  brokerTimer = setInterval(() => {
    void syncPublicBroker().catch((error: unknown) => {
      app.log.warn(
        { err: { message: error instanceof Error ? error.message : 'Broker sync failed' } },
        'Public broker sync failed',
      );
    });
  }, intervalMs);
}
