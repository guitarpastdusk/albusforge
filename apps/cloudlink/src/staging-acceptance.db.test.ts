import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type DbConfig } from '@albusforge/db';
import { runMigrations } from '@albusforge/db/migrate';
import { MemoryObservationStorage } from '@albusforge/storage/testing';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { runStagingIngest } from './staging-acceptance.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let app: FastifyInstance;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withTmpFs({ '/var/lib/postgresql/data': 'rw' }).withUsername('postgres').withPassword('postgres').withDatabase('postgres').start();
  const admin = new Pool({ connectionString: container.getConnectionUri() });
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'fixture-secret'");
  await admin.query('CREATE DATABASE albus OWNER albus_migrate');
  await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: 'albus', user: 'albus_migrate', password: 'fixture-secret', ssl: 'disable' };
  await runMigrations(config, { appRole: { name: 'albus_app', password: 'fixture-app-secret' } });
  pool = createDb({ ...config, user: 'albus_app', password: 'fixture-app-secret' }, { max: 2 }).pool;
});
afterAll(async () => { vi.unstubAllGlobals(); await app?.close(); await pool?.end(); await container?.stop(); });
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
