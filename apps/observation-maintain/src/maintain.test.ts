import { createHash, randomUUID } from "node:crypto";
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { MemoryObservationStorage } from "@albusforge/storage/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { maintainObservations } from "./maintain.js";

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let clock: number;
const hash = "a".repeat(64);
const bytes = Buffer.from("already validated upload bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "migrate-secret", ssl: "disable" };
  await runMigrations(config, { appRole: { name: "albus_app", password: "app-secret" } });
  pool = createDb({ ...config, user: "albus_app", password: "app-secret" }, { max: 4, connectTimeoutMs: 5000, statementTimeoutMs: 5000, queryTimeoutMs: 6000 }).pool;
});
beforeEach(async () => {
  clock = Date.now();
  await pool.query("DELETE FROM users.tenants");
  await pool.query("DELETE FROM telemetry.observation_deletion_intents");
  await pool.query("DELETE FROM telemetry.observation_maintenance_state");
});
afterAll(async () => { await pool?.end(); await container?.stop(); });
async function fixture(upload = true) {
  const tenant = randomUUID(), device = randomUUID(), observation = randomUUID();
  const key = `tenant/${tenant}/device/${device}/${observation}.jpg`;
  await pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'maintenance fixture')", [tenant]);
  await pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,'{}','{}')", [device, tenant, hash]);
  await pool.query(`INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,max_bytes,max_width,max_height)
    VALUES($1,'camera','image','jpeg.v1','fixture',1,900,1048576,320,240)`, [device]);
  await pool.query(`INSERT INTO telemetry.observation_receipts(device_id,observation_id,capability_id,fingerprint,sha256,bytes,captured_at,expires_at,state,lease_id,lease_until,reserved_day,reservation_credential_hash)
    VALUES($1,$2,'camera',$3,$4,$5,$6,$7,'reserved',$8,$9,$10,$3)`, [device, observation, hash, sha256, bytes.length,
    new Date(clock - 60_000), new Date(clock + 30 * 86_400_000), randomUUID(), new Date(clock - 1000), new Date(clock).toISOString().slice(0, 10)]);
  await pool.query("INSERT INTO telemetry.observation_images(device_id,observation_id,object_key,width,height) VALUES($1,$2,$3,320,240)", [device, observation, key]);
  const store = new MemoryObservationStorage(undefined, () => new Date(clock - 180_000));
  if (upload) await store.create(key, bytes, { sha256, fingerprint: hash });
  return { tenant, device, observation, key, store,
    run: () => maintainObservations(pool, store, { now: () => new Date(clock) }),
    receipt: async () => (await pool.query("SELECT * FROM telemetry.observation_receipts WHERE device_id=$1 AND observation_id=$2", [device, observation])).rows[0] };
}
it("reconciles a stored object with its stale reservation exactly once under the restricted role", async () => {
  const f = await fixture();
  expect(await f.run()).toMatchObject({ finalized: 1, errors: 0 });
  const first = await f.receipt();
  expect(first).toMatchObject({ state: "stored", lease_id: null, lease_until: null });
  clock += 60_000;
  expect(await f.run()).toMatchObject({ finalized: 0, errors: 0 });
  expect((await f.receipt()).received_at).toEqual(first.received_at);
  expect((await pool.query("SELECT accepted_count,accepted_bytes FROM telemetry.observation_usage WHERE device_id=$1", [f.device])).rows).toEqual([{ accepted_count: "1", accepted_bytes: String(bytes.length) }]);
});
it.each(["revoked", "rotated", "legacy"] as const)("expires a %s reservation instead of authorizing it again", async mode => {
  const f = await fixture();
  if (mode === "revoked") await pool.query("UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1", [f.device]);
  if (mode === "rotated") await pool.query("UPDATE telemetry.devices SET token_hash=$2 WHERE id=$1", [f.device, "b".repeat(64)]);
  if (mode === "legacy") await pool.query("UPDATE telemetry.observation_receipts SET reservation_credential_hash=NULL WHERE device_id=$1", [f.device]);
  expect(await f.run()).toMatchObject({ expired: 1, finalized: 0 });
  expect((await f.receipt()).state).toBe("expired");
  expect((await pool.query("SELECT object_key FROM telemetry.observation_deletion_intents")).rows).toEqual([{ object_key: f.key }]);
});
it("fences a stale worker when an HTTP retry takes over its lease during object I/O", async () => {
  const f = await fixture();
  const head = f.store.head.bind(f.store);
  const newLease = randomUUID();
  f.store.head = async (...args) => {
    await pool.query("UPDATE telemetry.observation_receipts SET lease_id=$2,lease_until=$3 WHERE device_id=$1", [f.device, newLease, new Date(clock + 60_000)]);
    return head(...args);
  };
  expect(await f.run()).toMatchObject({ finalized: 0, deferred: 1 });
  expect(await f.receipt()).toMatchObject({ state: "reserved", lease_id: newLease });
});
it("rechecks credential revocation after object I/O", async () => {
  const f = await fixture();
  const head = f.store.head.bind(f.store);
  f.store.head = async (...args) => { await pool.query("UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1", [f.device]); return head(...args); };
  expect(await f.run()).toMatchObject({ finalized: 0, expired: 1 });
  expect((await f.receipt()).state).toBe("expired");
});
it("does not finalize mismatched objects or missing uploads", async () => {
  const f = await fixture(false);
  expect(await f.run()).toMatchObject({ finalized: 0, deferred: 1 });
  expect((await f.receipt()).state).toBe("failed");
  await f.store.create(f.key, bytes, { sha256, fingerprint: "c".repeat(64) });
  clock += 31_000;
  expect(await f.run()).toMatchObject({ finalized: 0, expired: 1 });
});
it("preserves tombstones while deleting expired content after the grace period", async () => {
  const f = await fixture();
  await f.run();
  await pool.query("UPDATE telemetry.observation_receipts SET expires_at=$2 WHERE device_id=$1", [f.device, new Date(clock - 1)]);
  expect(await f.run()).toMatchObject({ expired: 1, deleted: 0 });
  await pool.query("UPDATE telemetry.observation_deletion_intents SET queued_at=$1", [new Date(clock - 180_000)]);
  expect(await f.run()).toMatchObject({ deleted: 1, errors: 0 });
  expect(await f.store.head(f.key)).toBeNull();
  expect((await f.receipt()).state).toBe("expired");
});
it("cleans a late upload after device deletion even when its intent has no generation", async () => {
  const f = await fixture(false);
  await pool.query("DELETE FROM users.tenants WHERE id=$1", [f.tenant]);
  await f.store.create(f.key, bytes, { sha256, fingerprint: hash });
  await pool.query("UPDATE telemetry.observation_deletion_intents SET queued_at=$1", [new Date(clock - 180_000)]);
  expect(await f.run()).toMatchObject({ deleted: 1, errors: 0 });
  expect(f.store.size).toBe(0);
});
it("checks quota again when recovery crosses a UTC receipt day", async () => {
  const f = await fixture();
  clock += 86_400_000;
  const day = new Date(clock).toISOString().slice(0, 10);
  await pool.query("INSERT INTO telemetry.observation_usage(device_id,day,accepted_count,accepted_bytes) VALUES($1,$2,1200,0)", [f.device, day]);
  expect(await f.run()).toMatchObject({ finalized: 0, deferred: 1 });
  await pool.query("UPDATE telemetry.observation_usage SET accepted_count=0 WHERE device_id=$1", [f.device]);
  expect(await f.run()).toMatchObject({ finalized: 1 });
  expect((await pool.query("SELECT day,accepted_count FROM telemetry.observation_usage WHERE device_id=$1", [f.device])).rows).toEqual([{ day, accepted_count: "1" }]);
});
it("serializes competing sweepers without holding a SQL transaction over storage I/O", async () => {
  const f = await fixture();
  let entered!: () => void, unblock!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const head = f.store.head.bind(f.store);
  f.store.head = async (...args) => { entered(); await blocked; return head(...args); };
  const first = f.run();
  try {
    await started;
    expect(await f.run()).toMatchObject({ busy: true, finalized: 0 });
    unblock();
    expect(await first).toMatchObject({ finalized: 1 });
  } finally { unblock(); await first; }
});
it("persists bounded orphan scan progress and skips newly created objects", async () => {
  const store = new MemoryObservationStorage(undefined, () => new Date(clock - 180_000));
  const prefix = `tenant/${randomUUID()}/device/${randomUUID()}`;
  await store.create(`${prefix}/${randomUUID()}.jpg`, bytes, { sha256, fingerprint: hash });
  await store.create(`${prefix}/${randomUUID()}.jpg`, bytes, { sha256, fingerprint: hash });
  const run = () => maintainObservations(pool, store, { now: () => new Date(clock), limit: 1 });
  expect(await run()).toMatchObject({ orphans: 1 });
  expect((await pool.query("SELECT orphan_page_token FROM telemetry.observation_maintenance_state")).rows[0].orphan_page_token).not.toBeNull();
  expect(await run()).toMatchObject({ orphans: 1 });
  expect((await pool.query("SELECT count(*)::int AS n FROM telemetry.observation_deletion_intents")).rows).toEqual([{ n: 2 }]);
  const young = new MemoryObservationStorage(undefined, () => new Date(clock));
  await young.create(`${prefix}/${randomUUID()}.jpg`, bytes, { sha256, fingerprint: hash });
  expect(await maintainObservations(pool, young, { now: () => new Date(clock) })).toMatchObject({ orphans: 0 });
});

it("never deletes referenced images or unrelated object names", async () => {
  const f = await fixture();
  await f.run();
  const object = await f.store.head(f.key);
  await pool.query("INSERT INTO telemetry.observation_deletion_intents(object_key,generation,queued_at) VALUES($1,$2,$3)", [f.key, object!.generation, new Date(clock-180_000)]);
  await f.store.create("tenant/foreign-document", bytes, { sha256, fingerprint: hash });
  expect(await f.run()).toMatchObject({ deleted: 0, orphans: 0, errors: 1 });
  expect(f.store.size).toBe(2);
});
it("keeps an ambiguous storage failure recoverable and releases the worker lock", async () => {
  const f = await fixture();
  const head = f.store.head.bind(f.store);
  f.store.head = async () => { throw new Error("simulated storage transport failure"); };
  expect(await f.run()).toMatchObject({ finalized: 0, errors: 1 });
  expect((await f.receipt()).state).toBe("reserved");
  f.store.head = head;
  clock += 31_000;
  expect(await f.run()).toMatchObject({ finalized: 1, busy: false, errors: 0 });
});
it("reconciles case-insensitive UUID identities while preserving the exact object key", async () => {
  const f = await fixture(false);
  const uppercaseKey = `tenant/${f.tenant.toUpperCase()}/device/${f.device.toUpperCase()}/${f.observation.toUpperCase()}.jpg`;
  await pool.query("UPDATE telemetry.observation_images SET object_key=$2 WHERE device_id=$1", [f.device, uppercaseKey]);
  await f.store.create(uppercaseKey, bytes, { sha256, fingerprint: hash });
  expect(await f.run()).toMatchObject({ finalized: 1, expired: 0, errors: 0 });
  expect((await f.receipt()).state).toBe("stored");
  expect(await f.store.head(uppercaseKey)).not.toBeNull();
});
