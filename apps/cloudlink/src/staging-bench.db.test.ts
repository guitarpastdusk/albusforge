import { afterAll, beforeAll, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type DbConfig } from '@albusforge/db';
import { runMigrations } from '@albusforge/db/migrate';
import { Pool } from 'pg';
import { trackTestPool, closeTestPool } from '../../gateway/src/test-pool-shutdown.js';
import { randomUUID } from 'node:crypto';
import { BENCH_CHANNELS, BenchJournal, createBenchSql, cleanupBenchSql } from './staging-bench.js';
let container: StartedPostgreSqlContainer;
let pool: Pool;

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
afterAll(async () => { await closeTestPool(pool); await container?.stop(); });

function journal() { return BenchJournal.parse({v:1,kind:'staging-camera-bench',project:'albusforge-staging',origin:'https://staging.albusforge.ai',tenant:randomUUID(),device:randomUUID(),run:randomUUID(),manifest_digest:'a'.repeat(64),job_image:`us-central1-docker.pkg.dev/albusforge-ci/albusforge/db-jobs@sha256:${'b'.repeat(64)}`}); }
it('creates only a bench device with exact Plant A capabilities; cleanup retains intents and fences recreation', async () => {
 const j=journal(); await pool.query(createBenchSql(j,'c'.repeat(64)));
 expect((await pool.query('SELECT next_s,channels FROM telemetry.devices WHERE id=$1',[j.device])).rows).toEqual([{next_s:900,channels:BENCH_CHANNELS}]);
 expect((await pool.query('SELECT capability_id,kind,payload_schema,interval_s,max_bytes,max_width,max_height,channels FROM telemetry.device_capabilities WHERE device_id=$1 ORDER BY capability_id',[j.device])).rows).toEqual([
  {capability_id:'camera',kind:'image',payload_schema:'jpeg.v1',interval_s:900,max_bytes:1048576,max_width:320,max_height:240,channels:null},
  {capability_id:'environment',kind:'measurement',payload_schema:'readings.v1',interval_s:900,max_bytes:null,max_width:null,max_height:null,channels:BENCH_CHANNELS},
 ]);
 const id=randomUUID(), key=`tenant/${j.tenant}/device/${j.device}/${id}.jpg`;
 await pool.query(`INSERT INTO telemetry.observation_receipts(device_id,observation_id,capability_id,fingerprint,sha256,bytes,captured_at,expires_at,state,lease_id,lease_until,reserved_day) VALUES($1,$2,'camera',$3,$3,100,now(),now()+interval '7 days','reserved',$4,now()+interval '30 seconds','2026-09-14')`,[j.device,id,'d'.repeat(64),randomUUID()]);
 await pool.query('INSERT INTO telemetry.observation_images(device_id,observation_id,object_key,width,height) VALUES($1,$2,$3,320,240)',[j.device,id,key]);
 await pool.query(cleanupBenchSql(j)); await pool.query(cleanupBenchSql(j));
 expect((await pool.query('SELECT id FROM telemetry.devices WHERE id=$1',[j.device])).rows).toEqual([]);
 expect((await pool.query('SELECT object_key,generation FROM telemetry.observation_deletion_intents WHERE object_key=$1',[key])).rows).toEqual([{object_key:key,generation:null}]);
 await expect(pool.query(createBenchSql(j,'c'.repeat(64)))).rejects.toThrow(); await pool.query('ROLLBACK');
});
it('cleanup before a delayed create leaves a durable fence, without needing bearer config',async()=>{
 const j=journal();await pool.query(cleanupBenchSql(j));
 await expect(pool.query(createBenchSql(j,'e'.repeat(64)))).rejects.toThrow();await pool.query('ROLLBACK');
 expect((await pool.query('SELECT id FROM telemetry.devices WHERE id=$1',[j.device])).rowCount).toBe(0);
});
it('refuses mismatched ownership and preserves the other device',async()=>{
 const j=journal();await pool.query(createBenchSql(j,'f'.repeat(64)));
 await expect(pool.query(cleanupBenchSql({...j,run:randomUUID()}))).rejects.toThrow('ownership');await pool.query('ROLLBACK');
 expect((await pool.query('SELECT revoked_at FROM telemetry.devices WHERE id=$1',[j.device])).rows).toEqual([{revoked_at:null}]);
 await pool.query(cleanupBenchSql(j));
});

it('serializes cleanup with an in-flight create commit and leaves the credential unusable',async()=>{
 const j=journal(),client=await pool.connect();let settled=false;
 try{
 await client.query(createBenchSql(j,'a'.repeat(64)).replace(/COMMIT;$/,''));
 const cleanup=pool.query(cleanupBenchSql(j)).then(()=>{settled=true;});
 await new Promise(resolve=>setTimeout(resolve,80));expect(settled).toBe(false);
 await client.query('COMMIT');await cleanup;
 expect((await pool.query('SELECT id FROM telemetry.devices WHERE id=$1',[j.device])).rowCount).toBe(0);
 }finally{await client.query('ROLLBACK');client.release();}
});
