import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type DbConfig } from '@albusforge/db';
import { runMigrations } from '@albusforge/db/migrate';
import { MemoryObservationStorage } from '@albusforge/storage/testing';
import { Pool } from 'pg';
import { trackTestPool, closeTestPool } from '../../gateway/src/test-pool-shutdown.js';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { runStagingIngest, runStagingIngestWithDatabase, type AcceptanceFixture } from './staging-acceptance.js';
import { randomUUID } from 'node:crypto';
import { jobAcceptanceDatabase, acceptanceProvisionSql, acceptanceCleanupSql } from './staging-acceptance-job.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let app: FastifyInstance;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withTmpFs({ '/var/lib/postgresql/data': 'rw' }).withUsername('postgres').withPassword('postgres').withDatabase('postgres').start();
  const admin = trackTestPool(new Pool({ connectionString: container.getConnectionUri() }));
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'fixture-secret'");
  await admin.query('CREATE DATABASE albus OWNER albus_migrate');
  await closeTestPool(admin);
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: 'albus', user: 'albus_migrate', password: 'fixture-secret', ssl: 'disable' };
  await runMigrations(config, { appRole: { name: 'albus_app', password: 'fixture-app-secret' } });
  pool = trackTestPool(createDb({ ...config, user: 'albus_app', password: 'fixture-app-secret' }, { max: 2 }).pool);
});
afterAll(async () => { vi.unstubAllGlobals(); await app?.close(); await closeTestPool(pool); await container?.stop(); });
it('runs the complete staging harness over loopback HTTP and cleans SQL/GCS fixtures', async () => {
  const store = new MemoryObservationStorage();
  app = buildApp({ pool, observations: { store }, log: () => {} });
  const local = await app.listen({ host: '127.0.0.1', port: 0 });
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, options: RequestInit) => {
    const target = new URL(url);
    expect(target.origin).toBe('https://staging.albusforge.ai');
    return original(`${local}${target.pathname}`, options);
  });
  const result = await runStagingIngest(pool, store, 'https://staging.albusforge.ai');
  expect(result.status).toBe('passed'); expect(store.size).toBe(0);
  expect((await pool.query('SELECT count(*)::int AS n FROM telemetry.devices WHERE id=$1', [result.device])).rows[0].n).toBe(0);
  expect((await pool.query('SELECT count(*)::int AS n FROM telemetry.observation_deletion_intents')).rows[0].n).toBe(0);
});

it('runs the same HTTP checks through remote SQL transactions and verifies usage/objects once', async () => {
  const store = new MemoryObservationStorage();
  await app?.close();
  app = buildApp({ pool, observations: { store }, log: () => {} });
  const local = await app.listen({ host: '127.0.0.1', port: 0 });
  vi.unstubAllGlobals(); const original = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, options: RequestInit) => original(`${local}${new URL(url).pathname}`, options));
  const statements: string[] = [];
  const execute = async (sql: string) => { statements.push(sql); const client = await pool.connect(); try { await client.query(sql); } finally { await client.query('ROLLBACK'); client.release(); } };
  const journal = vi.fn(async () => {});
  const result = await runStagingIngestWithDatabase(jobAcceptanceDatabase(execute, store, journal), store, 'https://staging.albusforge.ai');
  expect(result.status).toBe('passed'); expect(store.size).toBe(0);
  expect(journal).toHaveBeenCalledOnce(); expect(statements).toHaveLength(4);
  expect((await pool.query('SELECT count(*)::int AS n FROM telemetry.devices WHERE id=$1', [result.device])).rows[0].n).toBe(0);
  expect((await pool.query('SELECT count(*)::int AS n FROM telemetry.observation_deletion_intents')).rows[0].n).toBe(0);
});

it('retains a durable unique tenant fence after ambiguous provisioning, rejecting a late create', async () => {
  const tenant=randomUUID(), device=randomUUID(), observation=randomUUID();
  const fixture: AcceptanceFixture={tenant,device,observation,key:`tenant/${tenant}/device/${device}/${observation}.jpg`,tokenHash:'a'.repeat(64),source:{kind:'staging-acceptance',run:tenant}};
  const execute=async(sql:string)=>{ const client=await pool.connect();try{await client.query(sql);}finally{await client.query('ROLLBACK');client.release();} };
  // Cleanup can arrive before the submitted provisioning execution starts.
  await execute(acceptanceCleanupSql(fixture,false));
  await expect(execute(acceptanceProvisionSql(fixture))).rejects.toThrow();
  expect((await pool.query('SELECT name FROM users.tenants WHERE id=$1',[tenant])).rows[0].name).toContain('cleanup fence');
  expect((await pool.query('SELECT count(*)::int AS n FROM telemetry.devices WHERE id=$1',[device])).rows[0].n).toBe(0);
  // Repeated recovery is scoped/idempotent, refreshes grace, and retains the fence.
  await pool.query("UPDATE telemetry.observation_deletion_intents SET queued_at='2000-01-01' WHERE object_key=$1",[fixture.key]);
  await execute(acceptanceCleanupSql(fixture,false));
  expect((await pool.query("SELECT queued_at>now()-interval '1 minute' AS fresh FROM telemetry.observation_deletion_intents WHERE object_key=$1",[fixture.key])).rows[0].fresh).toBe(true);
  await pool.query('DELETE FROM telemetry.observation_deletion_intents WHERE object_key=$1',[fixture.key]);
  await pool.query('DELETE FROM users.tenants WHERE id=$1',[tenant]);
});
