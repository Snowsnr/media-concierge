import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  MockArrClient,
  MockMediaServerClient,
  MockMetadataProvider,
  MockPublicBroker,
  MockPushProvider,
  MockSubtitleClient,
  MockTorrentClient,
  SupabasePublicRequestBroker,
} from '@media-concierge/integrations';
import {
  adminDecisionSchema,
  createRequestSchema,
  createInvitationSchema,
  downloadControlSchema,
  episodeActionSchema,
  mockScenarioSchema,
  subtitleSelectionSchema,
  toFamilyRequest,
  type CreatedInvitation,
  type FamilyAccountSummary,
  type InvitationSummary,
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
const arr = new MockArrClient();
const torrent = new MockTorrentClient();
const subtitles = new MockSubtitleClient();
const mediaServer = new MockMediaServerClient();
const brokerConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_BRIDGE_TOKEN);
const broker = brokerConfigured
  ? new SupabasePublicRequestBroker({
      supabaseUrl: process.env.SUPABASE_URL!,
      bridgeToken: process.env.SUPABASE_BRIDGE_TOKEN!,
    })
  : new MockPublicBroker();
const push = new MockPushProvider();

const requestParams = z.object({ id: z.string().uuid() });
const selectionBody = z.object({ candidateId: z.string().min(1).max(200) });
const episodeParams = z.object({ id: z.string().uuid(), episodeId: z.string().uuid() });
const resetFamilyPasswordBody = z.object({ password: z.string().min(10).max(72) });

const continueAfterImport = (id: string) => {
  repository.setAllAiredEpisodeStates(id, 'IMPORTED');
  repository.transition(
    id,
    'WAITING_FOR_BAZARR',
    'system',
    'Archivo importado. Esperando reconocimiento de Bazarr.',
  );
  repository.setAllAiredEpisodeStates(id, 'SUBTITLES_REQUIRED');
  return repository.transition(
    id,
    'SUBTITLES_REQUIRED',
    'system',
    'Subtítulos simulados listos para revisión manual.',
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

app.get('/health', async () => ({
  status: 'ok',
  mode: brokerConfigured ? 'supabase-broker' : 'mock',
  service: 'media-concierge-api',
}));

app.get('/api/integrations/health', async () =>
  Promise.all([
    metadata.health(),
    broker.health(),
    arr.health(),
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
    return repository.transition(id, 'REJECTED', 'admin', decision.note || 'Solicitud rechazada.');
  }
  if (decision.action === 'clarify') {
    return repository.transition(
      id,
      'NEEDS_CLARIFICATION',
      'admin',
      decision.note || 'El administrador necesita más información.',
    );
  }
  repository.transition(
    id,
    'APPROVED',
    'admin',
    decision.note || 'Solicitud aprobada manualmente.',
  );
  repository.transition(id, 'ADDING_TO_ARR', 'system', 'Simulando alta segura en Radarr o Sonarr.');
  return repository.transition(
    id,
    'SELECTING_RELEASE',
    'system',
    'Resultados listos. Esperando selección manual del administrador.',
  );
});

app.get('/api/requests/:id/releases', async (request) => {
  const { id } = requestParams.parse(request.params);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  return arr.searchReleases(item);
});

app.post('/api/requests/:id/releases/select', async (request) => {
  const { id } = requestParams.parse(request.params);
  const { candidateId } = selectionBody.parse(request.body);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  const releases = await arr.searchReleases(item);
  const selected = releases.find((release) => release.id === candidateId);
  if (!selected) throw new Error('Release not found');
  await arr.grab(selected);
  repository.setRelease(id, selected.id);
  repository.setAllAiredEpisodeStates(id, 'QUEUED');
  repository.transition(
    id,
    'QUEUED',
    'admin',
    `Release seleccionado manualmente: ${selected.title}`,
  );
  return repository.transition(id, 'DOWNLOADING', 'system', 'Descarga simulada iniciada.');
});

app.post('/api/requests/:id/advance', async (request) => {
  const { id } = requestParams.parse(request.params);
  let item = repository.get(id);
  if (!item) throw new Error('Request not found');

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
      return repository.transition(
        id,
        'FAILED',
        'system',
        'Simulación: el cliente reportó archivos faltantes.',
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

app.get('/api/requests/:id/subtitles', async (request) => {
  const { id } = requestParams.parse(request.params);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  return item.mockScenario === 'no-subtitles' ? [] : subtitles.search(item);
});

app.post('/api/requests/:id/subtitles/select', async (request) => {
  const { id } = requestParams.parse(request.params);
  const { candidateId, episodeId } = subtitleSelectionSchema.parse(request.body);
  const item = repository.get(id);
  if (!item) throw new Error('Request not found');
  const candidates = await subtitles.search(item);
  const selected = candidates.find((candidate) => candidate.id === candidateId);
  if (!selected) throw new Error('Subtitle not found');
  await subtitles.download(selected);
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
  return repository.transition(
    id,
    'READY',
    'system',
    'Disponibilidad simulada confirmada en Jellyfin.',
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

  if (control.action === 'pause') {
    repository.setAllAiredEpisodeStates(id, 'PAUSED');
    return repository.transition(id, 'PAUSED', 'admin', 'Descarga pausada manualmente.');
  }
  if (control.action === 'resume') {
    repository.setScenario(id, 'none', 'admin');
    repository.setAllAiredEpisodeStates(id, 'DOWNLOADING');
    return repository.transition(id, 'DOWNLOADING', 'admin', 'Descarga reanudada manualmente.');
  }
  if (control.action === 'reannounce') {
    await torrent.reannounce(`mock-${item.selectedReleaseId ?? 'unknown'}`);
    return repository.recordEvent(id, 'admin', 'Reannounce solicitado al adaptador simulado.');
  }
  if (control.action === 'retry-release') {
    repository.setScenario(id, 'none', 'admin');
    repository.clearDownload(id);
    return repository.transition(
      id,
      'SELECTING_RELEASE',
      'admin',
      'Release anterior abandonado de forma coordinada; regresando a la búsqueda.',
    );
  }
  const deletion = control.deleteData
    ? ' Se borrarían los datos parciales.'
    : ' Se conservarían los datos parciales.';
  const blocklist = control.blocklist ? ' El release se añadiría a la blocklist.' : '';
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

const invitationFunction = async <T>(body: unknown): Promise<T> => {
  if (!brokerConfigured) throw new Error('Supabase broker is not configured');
  const response = await fetch(
    `${process.env.SUPABASE_URL!.replace(/\/$/, '')}/functions/v1/invitations`,
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
  if (!response.ok) throw new Error(`Invitation service returned ${response.status}`);
  return response.json() as Promise<T>;
};

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

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ message: 'Datos inválidos.', issues: error.issues });
  }
  const message = error instanceof Error ? error.message : 'Unknown request error';
  const name = error instanceof Error ? error.name : 'UnknownError';
  const status = message.includes('not found') ? 404 : message.startsWith('Invalid') ? 409 : 400;
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
