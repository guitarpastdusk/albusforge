import type { Pool } from 'pg';
import type { ObservationStorage } from '@albusforge/storage';
import { afterEach, expect, it, vi } from 'vitest';
import { runStagingIngest } from './staging-acceptance.js';

afterEach(() => { vi.unstubAllGlobals(); });

function fixture(failCommit = false) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const release = vi.fn();
  const transaction = vi.fn(async (sql: string, args: unknown[] = []) => {
    writes.push({ sql, args });
    if (sql === 'COMMIT' && failCommit) throw new Error('connection lost after server commit');
    return { rows: [] };
  });
  const cleanup = vi.fn(async (sql: string, args: unknown[] = []) => {
    writes.push({ sql, args });
    return { rows: [] };
  });
  const pool = { connect: async () => ({ query: transaction, release }), query: cleanup } as unknown as Pool;
  const head = vi.fn(), remove = vi.fn();
  const store = { head, delete: remove } as unknown as ObservationStorage;
  return { pool, store, writes, release, cleanup, head, remove };
}

function assertIsolatedCleanup(f: ReturnType<typeof fixture>) {
  const tenantWrite = f.writes.find(w => w.sql.startsWith('INSERT INTO users.tenants'))!;
  const deviceWrite = f.writes.find(w => w.sql.startsWith('INSERT INTO telemetry.devices'))!;
  const tenant = tenantWrite.args[0], device = deviceWrite.args[0];
  expect(f.cleanup.mock.calls.map(([sql]) => sql.split(' ')[0])).toEqual(['UPDATE', 'INSERT', 'DELETE']);
  expect(f.cleanup.mock.calls[0]![1]).toEqual([device, tenant, { kind: 'staging-acceptance', run: tenant }]);
  expect(f.cleanup.mock.calls[0]![0]).toContain('source=$3::jsonb');
  const intentKey = String(f.cleanup.mock.calls[1]![1]![0]);
  expect(intentKey).toMatch(new RegExp(`^tenant/${String(tenant)}/device/${String(device)}/[a-f0-9-]+\\.jpg$`));
  expect(f.cleanup.mock.calls[2]![1]).toEqual([tenant]);
  expect(f.cleanup.mock.calls[2]![0]).toContain("name='Staging observation acceptance'");
  expect(f.head).not.toHaveBeenCalled();
  expect(f.remove).not.toHaveBeenCalled();
}

it('revokes and retains durable object cleanup after an ambiguous provisioning commit', async () => {
  const f = fixture(true);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(runStagingIngest(f.pool, f.store, 'https://staging.albusforge.ai')).rejects.toThrow('connection lost');
  expect(f.release).toHaveBeenCalledWith(true);
  expect(fetch).not.toHaveBeenCalled();
  assertIsolatedCleanup(f);
});

it('retains a deletion intent for a timed-out upload that may finish remotely', async () => {
  const f = fixture();
  const fetch = vi.fn().mockRejectedValue(new Error('request timed out'));
  vi.stubGlobal('fetch', fetch);
  await expect(runStagingIngest(f.pool, f.store, 'https://staging.albusforge.ai')).rejects.toThrow('request timed out');
  expect(fetch).toHaveBeenCalledOnce();
  const [url, request] = fetch.mock.calls[0]!;
  expect(url).toMatch(/^https:\/\/staging\.albusforge\.ai\/ingest\/v2\/devices\//);
  expect(request.redirect).toBe('error');
  expect(request.signal).toBeInstanceOf(AbortSignal);
  assertIsolatedCleanup(f);
});

it('rejects a non-staging origin before acquiring SQL or object resources', async () => {
  const connect = vi.fn(), head = vi.fn();
  await expect(runStagingIngest({ connect } as unknown as Pool, { head } as unknown as ObservationStorage, 'https://albusforge.ai')).rejects.toThrow('Acceptance origin');
  expect(connect).not.toHaveBeenCalled();
  expect(head).not.toHaveBeenCalled();
});
