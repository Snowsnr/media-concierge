import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  assertTransition,
  publicStatusFor,
  type MediaMetadata,
  type MediaRequest,
  type EpisodeProgress,
  type EpisodeState,
  type MockScenario,
  type RequestHistoryEntry,
  type RequestState,
  type SeriesScope,
  type TorrentTelemetry,
} from '@media-concierge/shared';
import { mockCatalog } from '@media-concierge/integrations';

interface RequestRow {
  id: string;
  public_request_id: string | null;
  idempotency_key: string;
  media_json: string;
  requester_name: string;
  note: string | null;
  scope_json: string | null;
  state: string;
  progress: number;
  selected_release_id: string | null;
  download_id: string | null;
  torrent_json: string | null;
  selected_subtitle_id: string | null;
  mock_scenario: string;
  episodes_json: string;
  created_at: string;
  updated_at: string;
}

interface HistoryRow {
  id: string;
  request_id: string;
  from_state: string | null;
  to_state: string;
  actor: string;
  note: string;
  created_at: string;
}

export interface CreateRequestInput {
  publicRequestId?: string | null;
  media: MediaMetadata;
  requesterName: string;
  note: string;
  scope: SeriesScope | null;
  idempotencyKey: string;
}

export class RequestRepository {
  private readonly database: DatabaseSync;

  constructor(path = process.env.CONCIERGE_DB_PATH ?? './data/media-concierge.db') {
    const absolutePath = path === ':memory:' ? path : resolve(path);
    if (path !== ':memory:') mkdirSync(dirname(absolutePath), { recursive: true });
    this.database = new DatabaseSync(absolutePath);
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
    this.seed();
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        public_request_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        media_json TEXT NOT NULL,
        requester_name TEXT NOT NULL,
        note TEXT,
        scope_json TEXT,
        state TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        selected_release_id TEXT,
        download_id TEXT,
        torrent_json TEXT,
        selected_subtitle_id TEXT,
        mock_scenario TEXT NOT NULL DEFAULT 'none',
        episodes_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS request_history (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        from_state TEXT,
        to_state TEXT NOT NULL,
        actor TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS request_history_request_created
        ON request_history(request_id, created_at);
    `);
    const columns = this.database.prepare('PRAGMA table_info(requests)').all() as unknown as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === 'mock_scenario')) {
      this.database.exec(
        "ALTER TABLE requests ADD COLUMN mock_scenario TEXT NOT NULL DEFAULT 'none'",
      );
    }
    if (!columns.some((column) => column.name === 'episodes_json')) {
      this.database.exec(
        "ALTER TABLE requests ADD COLUMN episodes_json TEXT NOT NULL DEFAULT '[]'",
      );
    }
    if (!columns.some((column) => column.name === 'public_request_id')) {
      this.database.exec('ALTER TABLE requests ADD COLUMN public_request_id TEXT');
    }
    if (!columns.some((column) => column.name === 'download_id')) {
      this.database.exec('ALTER TABLE requests ADD COLUMN download_id TEXT');
    }
    if (!columns.some((column) => column.name === 'torrent_json')) {
      this.database.exec('ALTER TABLE requests ADD COLUMN torrent_json TEXT');
    }
    this.database.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS requests_public_request_id ON requests(public_request_id) WHERE public_request_id IS NOT NULL',
    );
  }

  private seed() {
    const media = mockCatalog[0];
    if (!media) throw new Error('Mock catalog is empty');
    this.create({
      media,
      requesterName: 'Ana',
      note: 'Para la noche de pelis del viernes 🍿',
      scope: null,
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    });
    const series = mockCatalog.find((item) => item.type === 'series');
    if (!series) throw new Error('Mock series catalog is empty');
    this.create({
      media: series,
      requesterName: 'Luis',
      note: 'La primera temporada, incluyendo lo que todavía no sale.',
      scope: { kind: 'season', seasonNumber: 1 },
      idempotencyKey: '00000000-0000-4000-8000-000000000002',
    });
  }

  reset() {
    this.database.exec('DELETE FROM request_history; DELETE FROM requests;');
    this.seed();
    return this.list();
  }

  list(): MediaRequest[] {
    const rows = this.database
      .prepare('SELECT * FROM requests ORDER BY created_at DESC')
      .all() as unknown as RequestRow[];
    return rows.map((row) => this.hydrate(row));
  }

  get(id: string): MediaRequest | null {
    const row = this.database.prepare('SELECT * FROM requests WHERE id = ?').get(id) as
      RequestRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  create(input: CreateRequestInput): MediaRequest {
    if (input.publicRequestId) {
      const brokerExisting = this.database
        .prepare('SELECT * FROM requests WHERE public_request_id = ?')
        .get(input.publicRequestId) as RequestRow | undefined;
      if (brokerExisting) return this.hydrate(brokerExisting);
    }
    const existing = this.database
      .prepare('SELECT * FROM requests WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as RequestRow | undefined;
    if (existing) return this.hydrate(existing);

    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO requests (
          id, public_request_id, idempotency_key, media_json, requester_name, note, scope_json,
          state, progress, mock_scenario, episodes_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'none', ?, ?, ?)`,
      )
      .run(
        id,
        input.publicRequestId ?? null,
        input.idempotencyKey,
        JSON.stringify(input.media),
        input.requesterName,
        input.note || null,
        input.scope ? JSON.stringify(input.scope) : null,
        'REQUESTED',
        JSON.stringify(this.createEpisodes(input)),
        now,
        now,
      );
    this.insertHistory(id, null, 'REQUESTED', 'family', 'Solicitud creada por el familiar.', now);
    return this.require(id);
  }

  transition(
    id: string,
    toState: RequestState,
    actor: RequestHistoryEntry['actor'],
    note: string,
  ): MediaRequest {
    const request = this.require(id);
    assertTransition(request.state, toState);
    const now = new Date().toISOString();
    this.database
      .prepare('UPDATE requests SET state = ?, updated_at = ? WHERE id = ?')
      .run(toState, now, id);
    this.insertHistory(id, request.state, toState, actor, note, now);
    return this.require(id);
  }

  setRelease(id: string, releaseId: string): MediaRequest {
    this.database
      .prepare('UPDATE requests SET selected_release_id = ? WHERE id = ?')
      .run(releaseId, id);
    return this.require(id);
  }

  setDownload(id: string, downloadId: string): MediaRequest {
    this.database
      .prepare('UPDATE requests SET download_id = ?, updated_at = ? WHERE id = ?')
      .run(downloadId, new Date().toISOString(), id);
    return this.require(id);
  }

  setTorrent(id: string, torrent: TorrentTelemetry): MediaRequest {
    this.database
      .prepare('UPDATE requests SET torrent_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(torrent), new Date().toISOString(), id);
    return this.require(id);
  }

  clearDownload(id: string): MediaRequest {
    const request = this.require(id);
    const episodes = request.episodes.map((episode) =>
      episode.aired
        ? { ...episode, state: 'QUEUED' as EpisodeState, progress: 0, downloadGroupId: null }
        : episode,
    );
    this.database
      .prepare(
        'UPDATE requests SET selected_release_id = NULL, download_id = NULL, torrent_json = NULL, progress = 0, episodes_json = ?, updated_at = ? WHERE id = ?',
      )
      .run(JSON.stringify(episodes), new Date().toISOString(), id);
    return this.require(id);
  }

  setSubtitle(id: string, subtitleId: string): MediaRequest {
    this.database
      .prepare('UPDATE requests SET selected_subtitle_id = ? WHERE id = ?')
      .run(subtitleId, id);
    return this.require(id);
  }

  setProgress(id: string, progress: number): MediaRequest {
    const bounded = Math.max(0, Math.min(100, Math.round(progress)));
    const request = this.require(id);
    const episodeState: EpisodeState = request.state === 'PAUSED' ? 'PAUSED' : 'DOWNLOADING';
    const episodes = request.episodes.map((episode) =>
      episode.aired && !['READY', 'READY_WITHOUT_SUBTITLES'].includes(episode.state)
        ? { ...episode, progress: bounded, state: episodeState }
        : episode,
    );
    this.database
      .prepare('UPDATE requests SET progress = ?, episodes_json = ?, updated_at = ? WHERE id = ?')
      .run(bounded, JSON.stringify(episodes), new Date().toISOString(), id);
    return this.require(id);
  }

  setScenario(
    id: string,
    scenario: MockScenario,
    actor: RequestHistoryEntry['actor'] = 'admin',
  ): MediaRequest {
    this.database
      .prepare('UPDATE requests SET mock_scenario = ?, updated_at = ? WHERE id = ?')
      .run(scenario, new Date().toISOString(), id);
    this.recordEvent(id, actor, `Escenario de prueba configurado: ${scenario}.`);
    return this.require(id);
  }

  setEpisodeState(
    id: string,
    episodeId: string,
    state: EpisodeState,
    selectedSubtitleId: string | null = null,
  ): MediaRequest {
    const request = this.require(id);
    let found = false;
    const episodes = request.episodes.map((episode) => {
      if (episode.id !== episodeId) return episode;
      found = true;
      return { ...episode, state, selectedSubtitleId };
    });
    if (!found) throw new Error('Episode not found');
    this.database
      .prepare('UPDATE requests SET episodes_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(episodes), new Date().toISOString(), id);
    return this.require(id);
  }

  setAllAiredEpisodeStates(id: string, state: EpisodeState): MediaRequest {
    const request = this.require(id);
    const episodes = request.episodes.map((episode) =>
      episode.aired
        ? { ...episode, state, progress: state === 'IMPORTED' ? 100 : episode.progress }
        : episode,
    );
    this.database
      .prepare('UPDATE requests SET episodes_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(episodes), new Date().toISOString(), id);
    return this.require(id);
  }

  recordEvent(id: string, actor: RequestHistoryEntry['actor'], note: string): MediaRequest {
    const request = this.require(id);
    const now = new Date().toISOString();
    this.insertHistory(id, request.state, request.state, actor, note, now);
    this.database.prepare('UPDATE requests SET updated_at = ? WHERE id = ?').run(now, id);
    return this.require(id);
  }

  close() {
    this.database.close();
  }

  private require(id: string): MediaRequest {
    const request = this.get(id);
    if (!request) throw new Error('Request not found');
    return request;
  }

  private insertHistory(
    requestId: string,
    fromState: RequestState | null,
    toState: RequestState,
    actor: RequestHistoryEntry['actor'],
    note: string,
    createdAt: string,
  ) {
    this.database
      .prepare(
        'INSERT INTO request_history (id, request_id, from_state, to_state, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), requestId, fromState, toState, actor, note, createdAt);
  }

  private hydrate(row: RequestRow): MediaRequest {
    const state = row.state as RequestState;
    const historyRows = this.database
      .prepare('SELECT * FROM request_history WHERE request_id = ? ORDER BY created_at ASC')
      .all(row.id) as unknown as HistoryRow[];
    return {
      id: row.id,
      publicRequestId: row.public_request_id,
      media: JSON.parse(row.media_json) as MediaMetadata,
      requesterName: row.requester_name,
      note: row.note,
      scope: row.scope_json ? (JSON.parse(row.scope_json) as SeriesScope) : null,
      state,
      publicStatus: publicStatusFor(state),
      progress: row.progress,
      selectedReleaseId: row.selected_release_id,
      downloadId: row.download_id,
      torrent: row.torrent_json ? (JSON.parse(row.torrent_json) as TorrentTelemetry) : null,
      selectedSubtitleId: row.selected_subtitle_id,
      mockScenario: row.mock_scenario as MockScenario,
      episodes: JSON.parse(row.episodes_json) as EpisodeProgress[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      history: historyRows.map((history) => ({
        id: history.id,
        fromState: history.from_state as RequestState | null,
        toState: history.to_state as RequestState,
        actor: history.actor as RequestHistoryEntry['actor'],
        note: history.note,
        createdAt: history.created_at,
      })),
    };
  }

  private createEpisodes(input: CreateRequestInput): EpisodeProgress[] {
    if (input.media.type !== 'series' || !input.scope) return [];
    const season = input.scope.kind === 'aired' ? 1 : input.scope.seasonNumber;
    const episodeNumbers =
      input.scope.kind === 'episode' ? [input.scope.episodeNumber] : [1, 2, 3, 4, 5, 6];
    return episodeNumbers.map((episodeNumber) => ({
      id: randomUUID(),
      seasonNumber: season,
      episodeNumber,
      title: episodeNumber === 3 ? 'Episodio doble' : `Episodio ${episodeNumber}`,
      aired: input.scope?.kind === 'aired' || episodeNumber <= 4,
      state: input.scope?.kind === 'aired' || episodeNumber <= 4 ? 'QUEUED' : 'UNAIRED',
      progress: 0,
      downloadGroupId:
        input.scope?.kind === 'episode' ? `episode-${episodeNumber}` : `season-pack-s${season}`,
      selectedSubtitleId: null,
    }));
  }
}
