import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { MemoryObservationStorage } from "@albusforge/storage/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { maintainObservations } from "../../observation-maintain/src/maintain.js";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").withTmpFs({ "/var/lib/postgresql/data": "rw,size=256m" }).start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() }); await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'local-migrate'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate"); await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "local-migrate", ssl: "disable" };
  await runMigrations(config, { appRole: { name: "albus_app", password: "local-app" } });
  handle = createDb({ ...config, user: "albus_app", password: "local-app" }, { max: 4, connectTimeoutMs: 1000, statementTimeoutMs: 4000, queryTimeoutMs: 5000 });
});
afterAll(async () => { await handle?.pool.end(); await container?.stop(); });
it("releases failed-upload quota and accepts the original queued photo after maintenance without losing its identity", async () => {
  let clock = Date.now();
  const device = randomUUID(), tenant = randomUUID(), observation = randomUUID(), token = randomBytes(32).toString("base64url");
  await handle.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'maintenance HTTP recovery')", [tenant]);
  await handle.pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,'{}','{}')", [device, tenant, createHash("sha256").update(token).digest("hex")]);
  await handle.pool.query(`INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,max_bytes,max_width,max_height)
    VALUES($1,'camera','image','jpeg.v1','test-camera',1,900,1048576,320,240)`, [device]);
  const store = new MemoryObservationStorage(undefined, () => new Date(clock));
  const create = store.create.bind(store);
  store.create = async () => { throw new Error("synthetic storage outage before object write"); };
  const app = buildApp({ pool: handle.pool, now: () => new Date(clock), observations: { store }, log: () => {} });
  const bytes = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 40, g: 80, b: 120 } } }).jpeg().toBuffer();
  const request = { method: "POST" as const, url: `/ingest/v2/devices/${device}/observations`, payload: bytes,
    headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg", "x-observation-id": observation,
      "x-capability-id": "camera", "x-payload-schema": "jpeg.v1", "x-captured-at": String(Math.floor(clock / 1000)),
      "x-content-sha256": createHash("sha256").update(bytes).digest("hex") } };
  try {
    expect((await app.inject(request)).statusCode).toBe(503);
    clock += 31_000;
    expect(await maintainObservations(handle.pool, store, { now: () => new Date(clock) })).toMatchObject({ finalized: 0, deferred: 1 });
    expect((await handle.pool.query("SELECT state,lease_id,lease_until FROM telemetry.observation_receipts WHERE device_id=$1", [device])).rows).toEqual([{ state: "failed", lease_id: null, lease_until: null }]);
    expect((await handle.pool.query("SELECT count(*)::int AS n FROM telemetry.observation_receipts WHERE device_id=$1 AND state='reserved'", [device])).rows).toEqual([{ n: 0 }]);
    store.create = create;
    const accepted = await app.inject(request); expect(accepted.statusCode).toBe(201);
    const retry = await app.inject(request); expect(retry.statusCode).toBe(200); expect(retry.json()).toEqual(accepted.json());
    expect(store.size).toBe(1);
    expect((await handle.pool.query("SELECT accepted_count,accepted_bytes FROM telemetry.observation_usage WHERE device_id=$1", [device])).rows).toEqual([{ accepted_count: "1", accepted_bytes: String(bytes.length) }]);
  } finally { await app.close(); }
});
