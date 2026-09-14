import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Storage } from '@google-cloud/storage';
import { GcsObservationStorage, StorageNotFoundError, StoragePreconditionError } from './index.js';
import { MemoryObservationStorage } from './testing.js';

const bytes = Buffer.from('fixture JPEG bytes');
const identity = { sha256: createHash('sha256').update(bytes).digest('hex'), fingerprint: 'a'.repeat(64) };
const metadata = { generation: '9223372036854775808', size: String(bytes.length), metadata: identity };
function client(request: ReturnType<typeof vi.fn>): Storage { return { authClient: { request } } as unknown as Storage; }

describe('memory object store semantics', () => {
  it('creates one immutable object across racing identical or conflicting attempts', async () => {
    const store = new MemoryObservationStorage();
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => store.create('a/key', bytes, identity)));
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(store.size).toBe(1);
    await expect(store.create('a/key', bytes, { ...identity, fingerprint: 'b'.repeat(64) })).rejects.toBeInstanceOf(StoragePreconditionError);
    expect(await store.head('a/key')).toEqual({ ...identity, generation: '1', bytes: bytes.length });
  });
  it('preserves newer generations after stale reads/deletes and copies returned bytes', async () => {
    const store = new MemoryObservationStorage();
    const first = await store.create('a', bytes, identity);
    const read = await store.read('a', first.generation); read.fill(0);
    expect(await store.read('a', first.generation)).toEqual(bytes);
    await store.delete('a', first.generation);
    const second = await store.create('a', bytes, identity);
    await store.delete('a', first.generation);
    expect(await store.head('a')).toMatchObject({ generation: second.generation });
    await expect(store.read('a', first.generation)).rejects.toBeInstanceOf(StorageNotFoundError);
    await store.delete('a', second.generation); await store.delete('a', second.generation);
    expect(await store.head('a')).toBeNull();
  });
  it('rejects wrong digest, oversized content and aborted operations before mutation', async () => {
    const store = new MemoryObservationStorage();
    await expect(store.create('a', bytes, { ...identity, sha256: 'b'.repeat(64) })).rejects.toThrow('digest');
    await expect(new MemoryObservationStorage(2).create('a', bytes, identity)).rejects.toThrow('size');
    await expect(store.create('a', bytes, identity, AbortSignal.abort())).rejects.toThrow();
    expect(store.size).toBe(0);
  });
});

describe('GCS adapter wire contract without cloud mutations', () => {
  it('uses ADC authenticated create-only multipart with immutable custom metadata', async () => {
    const request = vi.fn().mockResolvedValue({ data: metadata });
    const store = new GcsObservationStorage({ bucket: 'private-fixtures', client: client(request) });
    expect(await store.create('tenant/device/capture.jpg', bytes, identity)).toEqual({ ...identity, generation: metadata.generation, bytes: bytes.length });
    const options = request.mock.calls[0]![0];
    expect(options.url).toContain('uploadType=multipart&ifGenerationMatch=0');
    expect(options.retry).toBe(false);
    expect(options.data.toString()).toContain(JSON.stringify({ name: 'tenant/device/capture.jpg', contentType: 'image/jpeg', metadata: identity }));
    expect(options.data.includes(bytes)).toBe(true);
  });
  it('keeps 64-bit generations as strings and conditions both reads and deletes', async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: bytes }).mockResolvedValueOnce({ data: '' });
    const store = new GcsObservationStorage({ bucket: 'private-fixtures', client: client(request) });
    expect(await store.read('tenant/a b.jpg', metadata.generation)).toEqual(bytes);
    await store.delete('tenant/a b.jpg', metadata.generation);
    for (const [options] of request.mock.calls) {
      expect(options.url).toContain('tenant%2Fa%20b.jpg');
      expect(options.url).toContain(`generation=${metadata.generation}&ifGenerationMatch=${metadata.generation}`);
    }
  });
  it('maps only missing objects to null and precondition conflicts to explicit errors', async () => {
    const request = vi.fn().mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce({ response: { status: 412 } })
      .mockRejectedValueOnce({ response: { status: 403 } });
    const store = new GcsObservationStorage({ bucket: 'private-fixtures', client: client(request) });
    expect(await store.head('absent')).toBeNull();
    await expect(store.create('conflict', bytes, identity)).rejects.toBeInstanceOf(StoragePreconditionError);
    await expect(store.head('forbidden')).rejects.toEqual({ response: { status: 403 } });
  });
  it('aborts timed-out network work and awaits settlement without abandoned promises', async () => {
    let settled = false;
    const request = vi.fn().mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => { settled = true; reject(signal.reason); }, { once: true });
    }));
    const store = new GcsObservationStorage({ bucket: 'private-fixtures', timeoutMs: 10, client: client(request) });
    await expect(store.head('slow')).rejects.toThrow('Storage deadline exceeded');
    expect(settled).toBe(true);
  });
  it('propagates caller cancellation and rejects malformed storage metadata', async () => {
    const request = vi.fn().mockResolvedValue({ data: { ...metadata, metadata: {} } });
    const store = new GcsObservationStorage({ bucket: 'private-fixtures', client: client(request) });
    await expect(store.head('a', AbortSignal.abort())).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    await expect(store.head('a')).rejects.toThrow('identity');
  });
});
