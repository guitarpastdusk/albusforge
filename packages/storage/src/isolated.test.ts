import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GcsObservationStorage, StoragePreconditionError } from './index.js';
import { MemoryObservationStorage } from './testing.js';
import { createHash } from 'node:crypto';

describe('owned credential worker cancellation', () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'observation-worker-test-'));
    await writeFile(join(directory, 'blocked.cjs'), 'while (true) {}');
    await writeFile(join(directory, 'conflict.cjs'), 'require("node:worker_threads").parentPort.postMessage({error:{name:"StoragePreconditionError"}});');
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
  it('terminates even synchronous stuck credentials and releases capacity', async () => {
    const store = new GcsObservationStorage({ bucket: 'test-private', timeoutMs: 50, maxWorkers: 1, workerPath: join(directory, 'blocked.cjs') });
    const first = store.head('fixture');
    await expect(store.head('fixture')).rejects.toThrow('busy');
    await expect(first).rejects.toThrow('deadline');
    await expect(store.head('fixture')).rejects.toThrow('deadline');
  });
  it('cancels running work and keeps typed conflict semantics', async () => {
    const controller = new AbortController();
    const store = new GcsObservationStorage({ bucket: 'test-private', timeoutMs: 1000, workerPath: join(directory, 'blocked.cjs') });
    const pending = store.head('fixture', controller.signal);
    controller.abort(new Error('Caller cancelled'));
    await expect(pending).rejects.toThrow('Caller cancelled');
    const conflict = new GcsObservationStorage({ bucket: 'test-private', workerPath: join(directory, 'conflict.cjs') });
    await expect(conflict.head('fixture')).rejects.toBeInstanceOf(StoragePreconditionError);
  });
  it('lists bounded stable pages with provider creation time', async () => {
    const store = new MemoryObservationStorage(1024, () => new Date('2026-09-15T00:00:00Z'));
    const bytes = Buffer.from('jpeg'); const identity = { sha256: createHash('sha256').update(bytes).digest('hex'), fingerprint: 'a'.repeat(64) };
    for (const key of ['images/b', 'images/a', 'foreign/a']) await store.create(key, bytes, identity);
    const first = await store.list({ prefix: 'images/', limit: 1 });
    expect(first.objects).toEqual([{ key: 'images/a', generation: '2', createdAt: '2026-09-15T00:00:00.000Z' }]);
    const next = await store.list({ prefix: 'images/', pageToken: first.nextPageToken!, limit: 1 });
    expect(next.objects[0]?.key).toBe('images/b'); expect(next.nextPageToken).toBeNull();
  });
});
