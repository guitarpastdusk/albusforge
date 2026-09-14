import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createTestDb as createDb, closeTestPool } from "../test/pool-shutdown.js";
import { runMigrations, MIGRATIONS_FOLDER } from "./migrate.js";
import { maintainTelemetryStorage, processTelemetryRollups } from "./telemetry-storage.js";

import { readTelemetryHealth } from "./telemetry-health.js";

let container: StartedPostgreSqlContainer;
let owner: ReturnType<typeof createDb>;
let app: ReturnType<typeof createDb>;
let dev: string;
const hour = new Date(Math.floor(Date.now() / 3600000) * 3600000 - 3600000);
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const config = { host: container.getHost(), port: container.getPort(), database: container.getDatabase(), user: container.getUsername(), password: container.getPassword(), ssl: "disable" as const };
  await runMigrations(config, { appRole: { name: "albus_app", password: "test-app" } });
  owner = createDb(config, { max: 2, statementTimeoutMs: 15000 });
  app = createDb({ ...config, user: "albus_app", password: "test-app" }, { max: 3, statementTimeoutMs: 10000 });
});
afterAll(async () => { await closeTestPool(app?.pool); await closeTestPool(owner?.pool); await container?.stop(); });
beforeEach(async () => {
  await owner.pool.query("TRUNCATE telemetry.devices CASCADE");
  await owner.pool.query("UPDATE telemetry.retention_state SET raw_before='1970-01-01 00:00:00+00' WHERE id=1");
  const tenant = randomUUID(); dev = randomUUID();
  await owner.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'storage tests')", [tenant]);
  await owner.pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,$4,$5)", [dev, tenant, randomUUID(), {}, {}]);
});
async function insert(values: { value: number; offset: number }[], seq = 1, start = hour) {
  await app.pool.query(`INSERT INTO telemetry.readings(device_id,seq,ordinal,channel,ts,value)
    SELECT $1,$2,ordinal,'temperature_c',ts,value FROM jsonb_to_recordset($3::jsonb) AS r(ordinal integer,ts timestamptz,value double precision)`,
  [dev, seq, JSON.stringify(values.map((r, ordinal) => ({ ordinal, ts: new Date(start.getTime() + r.offset * 1000), value: r.value })))]);
}
async function rows(sql: string) { return (await app.pool.query(sql, [dev])).rows; }
it("routes raw data through native partitions and recomputes late data without double counting", async () => {
  expect((await owner.pool.query("SELECT relkind FROM pg_class WHERE oid='telemetry.readings'::regclass")).rows[0].relkind).toBe("p");
  await insert([{ value: 1, offset: 0 }, { value: 2, offset: 20 }, { value: 3, offset: 61 }]);
  expect(await processTelemetryRollups(app.pool)).toBe(1);
  const aggregate = (await rows("SELECT * FROM telemetry.rollups WHERE device_id=$1 AND resolution='1h'"))[0];
  expect(aggregate.n).toBe("3"); expect(Number(aggregate.sum)).toBe(6);
  expect([aggregate.min, aggregate.max, aggregate.last]).toEqual([1, 3, 3]);
  expect(Number(aggregate.stddev)).toBeCloseTo(Math.sqrt(2 / 3));
  expect((await rows("SELECT * FROM telemetry.rollups WHERE device_id=$1 AND resolution='1m'")).length).toBe(2);
  expect(await processTelemetryRollups(app.pool)).toBe(0);
  await insert([{ value: 4, offset: 61 }], 2);
  expect(await processTelemetryRollups(app.pool)).toBe(1);
  const updated = (await rows("SELECT * FROM telemetry.rollups WHERE device_id=$1 AND resolution='1h'"))[0];
  expect(updated.n).toBe("4"); expect(Number(updated.sum)).toBe(10); expect(updated.last).toBe(4);
});
it("lets concurrent workers claim a bucket once and keeps failed work queued", async () => {
  await insert([{ value: 1, offset: 0 }]);
  const done = await Promise.all([processTelemetryRollups(app.pool), processTelemetryRollups(app.pool)]);
  expect(done.reduce((a, b) => a + b, 0)).toBe(1);
  await insert([{ value: 2, offset: 0 }], 2);
  await owner.pool.query("REVOKE INSERT ON telemetry.rollups FROM albus_app");
  try { await expect(processTelemetryRollups(app.pool)).rejects.toThrow(); }
  finally { await owner.pool.query("GRANT INSERT ON telemetry.rollups TO albus_app"); }
  expect((await rows("SELECT * FROM telemetry.dirty_hours WHERE device_id=$1")).length).toBe(1);
  expect((await rows("SELECT n FROM telemetry.rollups WHERE device_id=$1 AND resolution='1h'"))[0].n).toBe("1");
  expect(await processTelemetryRollups(app.pool)).toBe(1);
});
it("keeps default-partition data during scheduler outages and drains it without losing markers", async () => {
  const backfill = new Date(hour.getTime() - 40 * 86400000);
  await insert([{ value: 5, offset: 0 }], 1, backfill);
  expect((await rows("SELECT tableoid::regclass::text AS partition FROM telemetry.readings WHERE device_id=$1"))[0].partition).toBe("telemetry.readings_default");
  await maintainTelemetryStorage(owner.pool);
  expect((await rows("SELECT tableoid::regclass::text AS partition FROM telemetry.readings WHERE device_id=$1"))[0].partition).toMatch(/^telemetry.readings_d\d{8}$/);
  expect((await rows("SELECT * FROM telemetry.dirty_hours WHERE device_id=$1")).length).toBe(1);
  await processTelemetryRollups(app.pool);
  expect((await rows("SELECT * FROM telemetry.rollups WHERE device_id=$1 AND resolution='1m'")).length).toBe(0);
  expect((await rows("SELECT n FROM telemetry.rollups WHERE device_id=$1 AND resolution='1h'"))[0].n).toBe("1");
});
it("defers raw expiry until aggregation, preserves hourly history, and rejects expired backfill", async () => {
  const old = new Date(hour.getTime() - 100 * 86400000);
  await owner.pool.query("SELECT telemetry.ensure_reading_partition($1::date)", [old.toISOString().slice(0, 10)]);
  await insert([{ value: 7, offset: 0 }], 1, old);
  const pending = await maintainTelemetryStorage(owner.pool);
  expect(pending.deferred).toBeGreaterThanOrEqual(1);
  expect((await rows("SELECT * FROM telemetry.readings WHERE device_id=$1")).length).toBe(1);
  await processTelemetryRollups(app.pool);
  expect((await maintainTelemetryStorage(owner.pool)).dropped).toBeGreaterThanOrEqual(1);
  expect((await rows("SELECT * FROM telemetry.readings WHERE device_id=$1")).length).toBe(0);
  const saved = (await rows("SELECT * FROM telemetry.rollups WHERE device_id=$1 AND resolution='1h'"))[0];
  expect(saved.n).toBe("1"); expect(Number(saved.sum)).toBe(7);
  await expect(insert([{ value: 8, offset: 0 }], 2, old)).rejects.toMatchObject({ constraint: "telemetry_retention_bound" });
  expect((await rows("SELECT * FROM telemetry.dirty_hours WHERE device_id=$1")).length).toBe(0);
});
it("keeps partition DDL out of the ingest application role", async () => {
  await expect(app.pool.query("SELECT telemetry.ensure_reading_partition(CURRENT_DATE+20)")).rejects.toMatchObject({ code: "42501" });
  await expect(maintainTelemetryStorage(app.pool)).rejects.toMatchObject({ code: "42501" });
});

it("upgrades a populated unpartitioned M6a database without losing raw data", async () => {
  const folder = await mkdtemp(join(tmpdir(), "telemetry-upgrade-"));
  const database = "upgrade_fixture";
  const config = { host: container.getHost(), port: container.getPort(), database, user: container.getUsername(), password: container.getPassword(), ssl: "disable" as const };
  await owner.pool.query(`CREATE DATABASE ${database}`);
  const legacy = createDb(config);
  try {
    await mkdir(join(folder, "meta"));
    const journal = JSON.parse(await readFile(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 2);
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) await writeFile(join(folder, `${entry.tag}.sql`), await readFile(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)));
    await runMigrations(config, { migrationsFolder: folder });
    const tenant = randomUUID(), device = randomUUID();
    await legacy.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'upgrade')", [tenant]);
    await legacy.pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,'upgrade-token','{}','{}')", [device, tenant]);
    await legacy.pool.query("INSERT INTO telemetry.readings VALUES($1,1,0,'temperature_c',CURRENT_TIMESTAMP,3),($1,1,1,'temperature_c',CURRENT_TIMESTAMP-interval '40 days',4)", [device]);
    await runMigrations(config, { appRole: { name: "albus_app", password: "test-app" } });
    expect((await legacy.pool.query("SELECT count(*) AS n FROM telemetry.readings")).rows[0].n).toBe("2");
    expect((await legacy.pool.query("SELECT count(*) AS n FROM telemetry.dirty_hours")).rows[0].n).toBe("2");
    expect(await processTelemetryRollups(legacy.pool)).toBe(2);
    expect((await legacy.pool.query("SELECT sum(n) AS n FROM telemetry.rollups WHERE resolution='1h'")).rows[0].n).toBe("2");
  } finally { await closeTestPool(legacy.pool); await rm(folder, { recursive: true, force: true }); }
});
it("requeues an ingest that waits while a worker deletes its claimed dirty marker", async () => {
  await insert([{ value: 1, offset: 0 }]);
  const worker = await owner.pool.connect();
  let pending: Promise<void> | undefined;
  try {
    await worker.query("BEGIN");
    await worker.query("SELECT 1 FROM telemetry.dirty_hours WHERE device_id=$1 FOR UPDATE", [dev]);
    pending = insert([{ value: 2, offset: 1 }], 2);
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      blocked = (await owner.pool.query("SELECT 1 FROM pg_stat_activity WHERE usename='albus_app' AND wait_event_type='Lock' LIMIT 1")).rowCount === 1;
      if (blocked) break;
      await delay(10);
    }
    expect(blocked).toBe(true);
    await worker.query("DELETE FROM telemetry.dirty_hours WHERE device_id=$1", [dev]);
    await worker.query("COMMIT");
    await pending;
    expect((await rows("SELECT * FROM telemetry.dirty_hours WHERE device_id=$1")).length).toBe(1);
    await processTelemetryRollups(app.pool);
    expect((await rows("SELECT n FROM telemetry.rollups WHERE device_id=$1 AND resolution='1h'"))[0].n).toBe("2");
  } finally { await worker.query("ROLLBACK"); worker.release(); await pending?.catch(() => {}); }
});

it("reports backlog age, default partition rows and empty health after rollup", async () => {
  expect(await readTelemetryHealth(app.pool)).toEqual({ dirty_hours: 0, oldest_dirty_seconds: 0, default_rows: 0 });
  const backfill = new Date(hour.getTime() - 500 * 86400000);
  await insert([{ value: 5, offset: 0 }, { value: 6, offset: 1 }], 1, backfill);
  await owner.pool.query("UPDATE telemetry.dirty_hours SET created_at=now()-interval '20 minutes'");
  const queued = await readTelemetryHealth(app.pool);
  expect(queued.dirty_hours).toBe(1);
  expect(queued.default_rows).toBe(2);
  expect(queued.oldest_dirty_seconds).toBeGreaterThanOrEqual(1200);
  expect(queued.oldest_dirty_seconds).toBeLessThan(1260);
  await processTelemetryRollups(app.pool);
  expect(await readTelemetryHealth(app.pool)).toEqual({ dirty_hours: 0, oldest_dirty_seconds: 0, default_rows: 2 });
});
