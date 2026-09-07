import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mockCatalog } from '@media-concierge/integrations';
import { toFamilyRequest } from '@media-concierge/shared';
import { RequestRepository } from './database.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('RequestRepository', () => {
  it('returns the original request when an idempotency key is repeated', () => {
    const repository = new RequestRepository(':memory:');
    const media = mockCatalog.find((item) => item.type === 'movie')!;
    const input = {
      media,
      requesterName: 'Test Family',
      note: '',
      scope: null,
      idempotencyKey: '10000000-0000-4000-8000-000000000001',
    } as const;

    const first = repository.create(input);
    const repeated = repository.create(input);

    expect(repeated.id).toBe(first.id);
    expect(repository.list()).toHaveLength(3);
    repository.close();
  });

  it('persists state and audit history across a database restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'media-concierge-test-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'concierge.db');
    const firstRepository = new RequestRepository(path);
    const request = firstRepository.list().find((item) => item.media.type === 'movie')!;
    firstRepository.transition(request.id, 'APPROVED', 'admin', 'Persistence test approval.');
    firstRepository.setDownload(request.id, 'radarr-download-id');
    firstRepository.close();

    const secondRepository = new RequestRepository(path);
    const restored = secondRepository.get(request.id);

    expect(restored?.state).toBe('APPROVED');
    expect(restored?.history.at(-1)?.note).toBe('Persistence test approval.');
    expect(restored?.downloadId).toBe('radarr-download-id');
    secondRepository.close();
  });

  it('deduplicates broker deliveries by their public request ID', () => {
    const repository = new RequestRepository(':memory:');
    const media = mockCatalog.find((item) => item.type === 'movie')!;
    const first = repository.create({
      publicRequestId: '20000000-0000-4000-8000-000000000001',
      media,
      requesterName: 'Test Family',
      note: '',
      scope: null,
      idempotencyKey: '30000000-0000-4000-8000-000000000001',
    });
    const repeated = repository.create({
      publicRequestId: '20000000-0000-4000-8000-000000000001',
      media,
      requesterName: 'Changed Name',
      note: 'Repeated delivery',
      scope: null,
      idempotencyKey: '30000000-0000-4000-8000-000000000002',
    });

    expect(repeated.id).toBe(first.id);
    expect(repeated.requesterName).toBe('Test Family');
    expect(repository.list()).toHaveLength(3);
    repository.close();
  });

  it('never exposes internal release details in a family request', () => {
    const repository = new RequestRepository(':memory:');
    const initial = repository.list().find((item) => item.media.type === 'movie')!;
    repository.transition(initial.id, 'APPROVED', 'admin', 'Approved internally.');
    repository.transition(initial.id, 'ADDING_TO_ARR', 'system', 'Radarr item 9128 accepted.');
    const internal = repository.transition(
      initial.id,
      'SELECTING_RELEASE',
      'system',
      'SECRET.RELEASE.GROUP.2160p from private-indexer.',
    );

    const publicPayload = JSON.stringify(toFamilyRequest(internal));
    expect(publicPayload).not.toContain('SECRET.RELEASE.GROUP');
    expect(publicPayload).not.toContain('private-indexer');
    expect(publicPayload).not.toContain('Radarr item');
    expect(publicPayload).toContain('Estamos preparando tu contenido.');
    repository.close();
  });

  it('creates a season matrix with a shared season-pack mapping and unaired episodes', () => {
    const repository = new RequestRepository(':memory:');
    const series = repository.list().find((item) => item.media.type === 'series')!;

    expect(series.episodes).toHaveLength(6);
    expect(series.episodes.filter((episode) => episode.aired)).toHaveLength(4);
    expect(new Set(series.episodes.map((episode) => episode.downloadGroupId))).toEqual(
      new Set(['season-pack-s1']),
    );
    expect(series.episodes.at(-1)?.state).toBe('UNAIRED');
    repository.close();
  });
});
