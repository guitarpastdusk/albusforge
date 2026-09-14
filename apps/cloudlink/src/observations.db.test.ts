import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { ObservationHeaders, ObservationMetadata } from "@albusforge/schema";
import { MemoryObservationStorage } from "@albusforge/storage/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import type { ObservationOptions } from "./observations.js";
import { buildApp } from "./app.js";
import { simulatorChannels } from "./local.js";
import { tokenHash } from "./routes.js";

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let owner: pg.Pool;
let jpeg: Buffer;
let clock: number;
const epoch = 1_789_300_000;
const services: FastifyInstance[] = [];
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").withTmpFs({ "/var/lib/postgresql/data": "rw,size=256m" }).start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "migrate-secret", ssl: "disable" };
  await runMigrations(config, { appRole: { name: "albus_app", password: "app-secret" } });
  owner = createDb(config).pool;
  pool = createDb({ ...config, user: "albus_app", password: "app-secret" }, { max: 8 }).pool;
  jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg().toBuffer();
});
beforeEach(() => { clock = epoch; });
afterAll(async () => {
  await Promise.all(services.map((app) => app.close()));
  await pool?.end(); await owner?.end(); await container?.stop();
});
async function fixture(store = new MemoryObservationStorage(), options: Partial<ObservationOptions> = {}) {
  const dev = randomUUID(), tenant = randomUUID(), token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'image test')", [tenant]);
  await pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,$4,$5)", [dev, tenant, tokenHash(token), simulatorChannels, { kind: "test" }]);
  await pool.query("INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,max_bytes,max_width,max_height) VALUES($1,'camera','image','jpeg.v1','test-camera',1,900,1048576,320,240)", [dev]);
  await pool.query("INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,channels) VALUES($1,'measurements','measurement','readings.v1','test-measurements',1,60,$2)", [dev, simulatorChannels]);
  const app = buildApp({ pool, now: () => new Date(clock * 1000), observations: { store, maxAttemptsPerMinute: 60, leaseMs: 30000, ...options }, log: () => {} });
  services.push(app);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const id = randomUUID();
  const headers = { authorization: `Bearer ${token}`, "content-type": "image/jpeg", "x-observation-id": id,
    "x-capability-id": "camera", "x-payload-schema": "jpeg.v1", "x-captured-at": String(epoch),
    "x-content-sha256": createHash("sha256").update(jpeg).digest("hex") };
  const send = async (overrides: Record<string, string> = {}, bytes = jpeg) => {
    const response = await fetch(`${origin}/ingest/v2/devices/${dev}/observations`, { method: "POST", headers: { ...headers, ...overrides }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: await response.json() };
  };
  const numeric = async () => {
    const response = await fetch(`${origin}/ingest/v1`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ v: 1, dev, seq: 1, ts: clock, r: [{ c: "temperature_c", t: clock, v: 22 }], st: { up_s: 60, health: ["OK"] } }), signal: AbortSignal.timeout(10_000) });
    return response.status;
  };
  return { dev, tenant, token, id, headers, send, numeric, store, origin };
}
async function count(dev: string, table: string) {
  return Number((await pool.query(`SELECT count(*) AS n FROM telemetry.${table} WHERE device_id=$1`, [dev])).rows[0].n);
}
it("posts a synthetic JPEG over real HTTP, replays a stable ack, and accounts once", async () => {
  const f = await fixture();
  const first = await f.send();
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({ observation_id: f.id, state: "stored", sha256: f.headers["x-content-sha256"], bytes: jpeg.length });
  expect(await f.send()).toEqual({ status: 200, body: first.body });
  expect(await count(f.dev, "observation_receipts")).toBe(1);
  expect(await count(f.dev, "observation_images")).toBe(1);
  expect((await pool.query("SELECT accepted_count,accepted_bytes FROM telemetry.observation_usage WHERE device_id=$1", [f.dev])).rows).toEqual([{ accepted_count: "1", accepted_bytes: String(jpeg.length) }]);
  expect(await f.numeric()).toBe(202);
  expect(await count(f.dev, "readings")).toBe(1);
});
it("rejects changed immutable identity and authenticates even committed retries", async () => {
  const f = await fixture(); await f.send();
  expect((await f.send({ "x-captured-at": String(epoch - 1) })).status).toBe(409);
  expect((await f.send({ authorization: `Bearer ${randomBytes(32).toString("base64url")}` })).status).toBe(401);
  await pool.query("UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1", [f.dev]);
  expect((await f.send()).status).toBe(401);
});
it("rejects disabled capabilities including exact retries", async () => {
  const f = await fixture(); await f.send();
  await pool.query("UPDATE telemetry.device_capabilities SET enabled=false WHERE device_id=$1", [f.dev]);
  expect((await f.send()).status).toBe(403);
});
it("rejects invalid JPEGs, digests, dimensions and capture times before committing", async () => {
  const f = await fixture();
  const garbage = Buffer.from("not a jpeg");
  expect((await f.send({ "x-content-sha256": createHash("sha256").update(garbage).digest("hex") }, garbage)).status).toBe(422);
  expect((await f.send({ "x-content-sha256": "0".repeat(64) })).status).toBe(422);
  for (const ts of [epoch - 7 * 86400 - 1, epoch + 301]) expect((await f.send({ "x-captured-at": String(ts) })).status).toBe(422);
  const large = await sharp({ create: { width: 321, height: 240, channels: 3, background: "white" } }).jpeg().toBuffer();
  expect((await f.send({ "x-content-sha256": createHash("sha256").update(large).digest("hex") }, large)).status).toBe(422);
  expect(await count(f.dev, "observation_receipts")).toBe(0);
});
it("replays old accepted captures before applying the new-capture age cutoff", async () => {
  const f = await fixture(); const first = await f.send(); expect(first.status).toBe(201);
  clock += 8 * 86400;
  expect(await f.send()).toEqual({ status: 200, body: first.body });
  expect((await f.send({ "x-observation-id": randomUUID() })).status).toBe(422);
  clock += 23 * 86400;
  expect((await f.send()).status).toBe(410);
});
it("keeps numeric ingest working during object storage failures and recovers an image retry", async () => {
  const store = new MemoryObservationStorage();
  const create = store.create.bind(store);
  let fail = true;
  store.create = async (...args) => { if (fail) throw new Error("injected unavailable storage"); return create(...args); };
  const f = await fixture(store);
  expect((await f.send()).status).toBe(503);
  expect(await f.numeric()).toBe(202);
  expect((await pool.query("SELECT count(*)::int AS n FROM telemetry.observation_receipts WHERE device_id=$1 AND state='stored'", [f.dev])).rows[0].n).toBe(0);
  fail = false; clock += 31;
  expect((await f.send()).status).toBe(201);
  expect((await f.send()).status).toBe(200);
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
it("returns retryable status for an in-flight duplicate, then the stable stored acknowledgment", async () => {
  const store = new MemoryObservationStorage(); const create = store.create.bind(store);
  const entered = gate(), resume = gate();
  store.create = async (...args) => { entered.release(); await resume.promise; return create(...args); };
  const f = await fixture(store, { maxDailyCount: 1 });
  const second = buildApp({ pool, now: () => new Date(clock * 1000), observations: { store, maxDailyCount: 1, maxAttemptsPerMinute: 60 }, log: () => {} });
  services.push(second);
  const secondOrigin = await second.listen({ host: "127.0.0.1", port: 0 });
  const first = f.send();
  try {
    await entered.promise;
    const duplicate = await fetch(`${secondOrigin}/ingest/v2/devices/${f.dev}/observations`, { method: "POST", headers: f.headers, body: new Uint8Array(jpeg), signal: AbortSignal.timeout(10_000) });
    expect(duplicate.status).toBe(503); await duplicate.text();
    expect((await f.send({ "x-observation-id": randomUUID() })).status).toBe(429);
  } finally { resume.release(); }
  const result = await first; expect(result.status).toBe(201);
  expect(await f.send()).toEqual({ status: 200, body: result.body });
});
it("does not finalize a pending upload after credential revocation during object storage", async () => {
  const store = new MemoryObservationStorage(); const create = store.create.bind(store);
  const entered = gate(), resume = gate();
  store.create = async (...args) => { entered.release(); await resume.promise; return create(...args); };
  const f = await fixture(store); const pending = f.send();
  try {
    await entered.promise;
    await pool.query("UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1", [f.dev]);
  } finally { resume.release(); }
  expect((await pending).status).toBe(401);
  expect((await pool.query("SELECT count(*)::int AS n FROM telemetry.observation_receipts WHERE device_id=$1 AND state='stored'", [f.dev])).rows[0].n).toBe(0);
});
it("recovers an object created before a lost storage response without counting it twice", async () => {
  const store = new MemoryObservationStorage(); const create = store.create.bind(store);
  let lose = true;
  store.create = async (...args) => {
    const result = await create(...args);
    if (lose) { lose = false; throw new Error("injected lost storage acknowledgment"); }
    return result;
  };
  const f = await fixture(store);
  expect((await f.send()).status).toBe(503);
  clock += 31;
  expect((await f.send()).status).toBe(201);
  expect((await f.send()).status).toBe(200);
  expect((await pool.query("SELECT accepted_count FROM telemetry.observation_usage WHERE device_id=$1", [f.dev])).rows).toEqual([{ accepted_count: "1" }]);
});
it("tracks each camera independently and backfill never moves capture presence backwards", async () => {
  const f = await fixture();
  await pool.query("INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,max_bytes,max_width,max_height) VALUES($1,'camera-rear','image','jpeg.v1','test-camera',1,900,1048576,320,240)", [f.dev]);
  expect((await f.send()).status).toBe(201);
  clock += 60;
  expect((await f.send({ "x-observation-id": randomUUID(), "x-captured-at": String(epoch - 100) })).status).toBe(201);
  expect((await f.send({ "x-observation-id": randomUUID(), "x-capability-id": "camera-rear", "x-captured-at": String(epoch - 200) })).status).toBe(201);
  const rows = (await pool.query("SELECT capability_id,last_capture_at,last_received_at FROM telemetry.capability_presence WHERE device_id=$1 ORDER BY capability_id", [f.dev])).rows;
  expect(rows).toEqual([
    { capability_id: "camera", last_capture_at: new Date(epoch * 1000), last_received_at: new Date(clock * 1000) },
    { capability_id: "camera-rear", last_capture_at: new Date((epoch - 200) * 1000), last_received_at: new Date(clock * 1000) },
  ]);
  expect((await pool.query("SELECT last_seq FROM telemetry.devices WHERE id=$1", [f.dev])).rows[0].last_seq).toBeNull();
});

it("strict observation contracts reject spoofed scope and malformed identity headers", async () => {
  const f = await fixture();
  for (const override of <Record<string, string>[]>[{ "x-observation-id": "../capture" }, { "x-captured-at": "1.5" }, { "x-captured-at": "0x123" }, { "x-content-sha256": "A".repeat(64) }]) {
    expect((await f.send(override)).status).toBe(400);
  }
  const headers = { "x-observation-id": f.id, "x-capability-id": "camera", "x-payload-schema": "jpeg.v1", "x-captured-at": String(epoch), "x-content-sha256": f.headers["x-content-sha256"] };
  expect(ObservationHeaders.safeParse(headers).success).toBe(true);
  expect(ObservationHeaders.safeParse({ ...headers, tenant_id: f.tenant }).success).toBe(false);
  expect(ObservationMetadata.safeParse({ observation_id: f.id, capability_id: "camera", payload_schema: "jpeg.v1", captured_at: epoch, sha256: f.headers["x-content-sha256"], object_key: "spoofed" }).success).toBe(false);
});

it("runs the synthetic-image simulator CLI and never prints its credential", async () => {
  clock = Math.floor(Date.now() / 1000);
  const f = await fixture();
  const dir = await mkdtemp(join(tmpdir(), "albus-images-test-"));
  const file = join(dir, "device.json");
  try {
    await writeFile(file, JSON.stringify({ dev: f.dev, token: f.token }), { mode: 0o600 });
    const result = await promisify(execFile)(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), "src/simulate-observations.ts", file, f.origin, "camera"]);
    expect(result.stdout).not.toContain(f.token);
    expect(result.stdout).toContain("Attempt 1: 201 ");
    expect(result.stdout).toContain("Attempt 2: 200 ");
    expect(await count(f.dev, "observation_receipts")).toBe(1);
    await expect(promisify(execFile)(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), "src/simulate-observations.ts", file, "https://example.com", "camera"])).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("recovers after object success and SQL finalization failure with no partial accounting", async () => {
  const f = await fixture();
  await owner.query("REVOKE INSERT ON telemetry.observation_usage FROM albus_app");
  try {
    expect((await f.send()).status).toBe(503);
    expect((await pool.query("SELECT state,received_at FROM telemetry.observation_receipts WHERE device_id=$1", [f.dev])).rows).toEqual([{ state: "reserved", received_at: null }]);
    expect(await count(f.dev, "observation_usage")).toBe(0);
    expect(await count(f.dev, "capability_presence")).toBe(0);
  } finally { await owner.query("GRANT INSERT ON telemetry.observation_usage TO albus_app"); }
  clock += 31;
  expect((await f.send()).status).toBe(201);
  expect((await f.send()).status).toBe(200);
  expect((await pool.query("SELECT accepted_count,accepted_bytes FROM telemetry.observation_usage WHERE device_id=$1", [f.dev])).rows).toEqual([{ accepted_count: "1", accepted_bytes: String(jpeg.length) }]);
});

it("holds image concurrency ownership through an aborted request's blocked authorization", async () => {
  const f = await fixture(new MemoryObservationStorage(), { maxInflight: 1 });
  const blocker = await owner.connect();
  const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM telemetry.devices WHERE id=$1 FOR UPDATE", [f.dev]);
  const controller = new AbortController();
  const pending = fetch(`${f.origin}/ingest/v2/devices/${f.dev}/observations`, { method: "POST", headers: f.headers, body: new Uint8Array(jpeg), signal: controller.signal }).then(() => undefined, () => undefined);
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const result = await owner.query("SELECT 1 FROM pg_stat_activity WHERE usename='albus_app' AND $1=ANY(pg_blocking_pids(pid))", [blockerPid]);
      if (result.rowCount) { waiting = true; break; }
      await delay(10);
    }
    expect(waiting).toBe(true);
    controller.abort(); await pending;
    await delay(50);
    expect((await f.send()).status).toBe(503);
  } finally { controller.abort(); await blocker.query("ROLLBACK"); blocker.release(); await pending; }
  let status = 503;
  for (let i = 0; i < 100 && status === 503; i++) { await delay(10); status = (await f.send()).status; }
  expect(status).toBe(201);
});
it("enforces receipt quotas while allowing exact retries and independent numeric traffic", async () => {
  const f = await fixture(new MemoryObservationStorage(), { maxDailyCount: 1 });
  expect((await f.send()).status).toBe(201);
  expect((await f.send({ "x-observation-id": randomUUID() })).status).toBe(429);
  expect((await f.send()).status).toBe(200);
  expect(await f.numeric()).toBe(202);
  expect(await count(f.dev, "observation_receipts")).toBe(1);
});
it("counts image attempts and resets their limit at the next UTC minute", async () => {
  const f = await fixture(new MemoryObservationStorage(), { maxAttemptsPerMinute: 2 });
  expect((await f.send()).status).toBe(201);
  expect((await f.send()).status).toBe(200);
  expect((await f.send()).status).toBe(429);
  expect(await f.numeric()).toBe(202);
  clock += 60;
  expect((await f.send()).status).toBe(200);
});

it("rejects unauthenticated, oversized and encoded uploads before object writes", async () => {
  const store = new MemoryObservationStorage(); const create = store.create.bind(store);
  let creates = 0;
  store.create = async (...args) => { creates++; return create(...args); };
  const f = await fixture(store);
  expect((await f.send({ authorization: "Bearer invalid" })).status).toBe(401);
  expect((await f.send({}, Buffer.alloc(1048577))).status).toBe(413);
  expect((await f.send({ "content-encoding": "gzip" })).status).toBe(415);
  expect((await f.send({ "content-type": "application/octet-stream" })).status).toBe(415);
  expect(creates).toBe(0);
  expect(await count(f.dev, "observation_receipts")).toBe(0);
});
it("rejects concatenated, trailing and truncated JPEG bodies", async () => {
  const f = await fixture();
  for (const bytes of [Buffer.concat([jpeg, jpeg]), Buffer.concat([jpeg, Buffer.from("trailing")]), jpeg.subarray(0, jpeg.length - 20)]) {
    expect((await f.send({ "x-content-sha256": createHash("sha256").update(bytes).digest("hex") }, bytes)).status).toBe(422);
  }
  expect(await count(f.dev, "observation_receipts")).toBe(0);
});
