import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { setTimeout as delay } from "node:timers/promises";
import { processTelemetryRollups, maintainTelemetryStorage } from "@albusforge/db/telemetry-storage";
import { SESSION_COOKIE, TelemetryDeviceDetail, TelemetryFleetPage, TelemetryHistory, TelemetryLatest } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "./app";
import { withSession } from "./session";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
let owner: pg.Pool;
let app: FastifyInstance;
const logs: string[] = [];
const hour = new Date(Math.floor(Date.now() / 3600000) * 3600000 - 3600000);
const time = (offset = 0) => new Date(hour.getTime() + offset * 1000).toISOString();
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "migrate-secret", ssl: "disable" };
  await runMigrations(config, { appRole: { name: "albus_app", password: "app-secret" } });
  owner = createDb(config).pool;
  handle = createDb({ ...config, user: "albus_app", password: "app-secret" }, { max: 5, connectTimeoutMs: 1000, statementTimeoutMs: 2000, queryTimeoutMs: 3000 });
  app = buildApp({ parts: { latest: async () => [] }, ping: async () => {}, telemetryPool: handle.pool,
    log: (_level, message, context) => { logs.push(JSON.stringify({ message, context })); } });
});
afterAll(async () => { await app?.close(); await handle?.pool.end(); await owner?.end(); await container?.stop(); });

async function fixture() {
  const tenant = randomUUID(), user = randomUUID(), device = randomUUID(), session = randomUUID();
  const token = randomBytes(32).toString("base64url"), hash = createHash("sha256").update(token).digest("hex");
  const deviceToken = randomBytes(32).toString("base64url"), deviceHash = createHash("sha256").update(deviceToken).digest("hex");
  await handle.pool.query("INSERT INTO users.tenants(id,name,slug) VALUES($1,'test',$2)", [tenant, `t-${tenant}`]);
  await handle.pool.query("INSERT INTO users.users(id,email) VALUES($1,$2)", [user, `${user}@example.test`]);
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [tenant, user]);
  await handle.pool.query("INSERT INTO users.sessions(id,token_hash,user_id,active_tenant_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [session, hash, user, tenant]);
  await handle.pool.query(`INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,
    '{"temperature_c":{"unit":"C","min":-40,"max":85}}','{"private":"provisioning secret"}')`, [device, tenant, deviceHash]);
  const cookie = `${SESSION_COOKIE}=${token}`;
  const get = (path: string, headers: Record<string, string> = {}) => app.inject({ url: path, headers: { cookie, ...headers } });
  const root = `/v1/telemetry/devices/${device}`;
  const series = (changes: Record<string, string> = {}) => `${root}/series?${new URLSearchParams({ channel: "temperature_c", from: time(), to: time(3600), ...changes })}`;
  const insert = async (seq: number, offset: number, value: number, ordinal = 0) => {
    await handle.pool.query("INSERT INTO telemetry.readings(device_id,seq,ordinal,channel,ts,value) VALUES($1,$2,$3,'temperature_c',$4,$5)", [device, seq, ordinal, time(offset), value]);
  };
  return { tenant, user, device, session, token, hash, deviceToken, deviceHash, cookie, get, root, series, insert };
}

it("requires the session cookie, rejects malformed/duplicate/expired/revoked credentials and never accepts a device or anonymous token", async () => {
  const f = await fixture();
  for (const cookie of ["", `${SESSION_COOKIE}=bad`, `${SESSION_COOKIE}=${f.deviceToken}`, `${SESSION_COOKIE}=${f.token}; ${f.cookie}`, `__Host-albus_anon=${f.token}`]) {
    const response = await f.get(f.root, { cookie, authorization: `Bearer ${f.deviceToken}` });
    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("private, no-store");
  }
  await handle.pool.query("UPDATE users.sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [f.session]);
  expect((await f.get(f.root)).statusCode).toBe(401);
  await handle.pool.query("UPDATE users.sessions SET expires_at=now()+interval '1 day',revoked_at=now() WHERE id=$1", [f.session]);
  expect((await f.get(f.root)).statusCode).toBe(401);
});

it("checks parent-session revocation and current membership on every request", async () => {
  const f = await fixture(), parent = randomUUID();
  await handle.pool.query("INSERT INTO users.sessions(id,token_hash,user_id,active_tenant_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [parent, randomUUID(), f.user, f.tenant]);
  await handle.pool.query("UPDATE users.sessions SET parent_session_id=$1 WHERE id=$2", [parent, f.session]);
  expect((await f.get(f.root)).statusCode).toBe(200);
  await handle.pool.query("UPDATE users.sessions SET revoked_at=now() WHERE id=$1", [parent]);
  expect((await f.get(f.root)).statusCode).toBe(401);
  await handle.pool.query("UPDATE users.sessions SET revoked_at=NULL WHERE id=$1", [parent]);
  await handle.pool.query("DELETE FROM users.tenant_members WHERE tenant_id=$1 AND user_id=$2", [f.tenant, f.user]);
  expect((await f.get(f.root)).statusCode).toBe(403);
});

it("scopes list/detail/latest/history to the active tenant and rejects caller tenant filters", async () => {
  const a = await fixture(), b = await fixture();
  for (const path of [b.root, `${b.root}/latest`, b.series()]) {
    const denied = await a.get(path);
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.message).toBe("Device not found");
  }
  expect(TelemetryFleetPage.parse((await a.get("/v1/telemetry/devices")).json()).devices.map((d) => d.id)).toEqual([a.device]);
  for (const path of [`/v1/telemetry/devices?tenant_id=${b.tenant}`, `${a.root}?tenant_id=${b.tenant}`, `${a.root}/latest?tenant_id=${b.tenant}`, a.series({ tenant_id: b.tenant })]) {
    expect((await a.get(path)).statusCode).toBe(400);
  }
  // Even membership in another tenant does not switch the active tenant on an ID lookup.
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'admin')", [b.tenant, a.user]);
  expect((await a.get(b.root)).statusCode).toBe(404);
  await handle.pool.query("UPDATE users.sessions SET active_tenant_id=$1 WHERE id=$2", [b.tenant, a.session]);
  expect((await a.get(b.root)).statusCode).toBe(200);
  expect((await a.get(a.root)).statusCode).toBe(404);
});

it("resolves public tenant hosts only with membership and ignores forwarded tenant/header spoofing", async () => {
  const a = await fixture(), b = await fixture();
  expect((await a.get(b.root, { host: `t-${b.tenant}.albusforge.ai` })).statusCode).toBe(403);
  expect((await a.get(a.root, { host: "missing-tenant.albusforge.ai" })).statusCode).toBe(404);
  expect((await a.get(a.root, { host: "albusforge.ai", "x-forwarded-host": `t-${b.tenant}.albusforge.ai`, "x-tenant-id": b.tenant })).statusCode).toBe(200);
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [b.tenant, a.user]);
  expect((await a.get(b.root, { host: `t-${b.tenant}.albusforge.ai` })).statusCode).toBe(200);
});

it("paginates a tenant's devices without duplicates, exposes state and keeps credentials/source private", async () => {
  const f = await fixture();
  for (let i = 0; i < 2; i++) await handle.pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source,last_seen_at) SELECT $1,tenant_id,$2,channels,source,now() FROM telemetry.devices WHERE id=$3", [randomUUID(), randomUUID(), f.device]);
  const first = await f.get("/v1/telemetry/devices?limit=2");
  const page = TelemetryFleetPage.parse(first.json());
  expect(page.devices).toHaveLength(2);
  const second = TelemetryFleetPage.parse((await f.get(`/v1/telemetry/devices?limit=2&after=${page.next_after}`)).json());
  expect(second.devices).toHaveLength(1); expect(second.next_after).toBeNull();
  expect(new Set([...page.devices, ...second.devices].map((d) => d.id)).size).toBe(3);
  const detail = await f.get(f.root);
  expect(TelemetryDeviceDetail.parse(detail.json()).device.status).toBe("never_seen");
  for (const secret of [f.token, f.hash, f.deviceToken, f.deviceHash, "provisioning secret", "token_hash", "source"]) {
    expect(first.body + detail.body + logs.join("\n")).not.toContain(secret);
  }
  await handle.pool.query("UPDATE telemetry.devices SET last_seen_at=now(),status='{\"up_s\":60,\"health\":[\"OK\"]}' WHERE id=$1", [f.device]);
  expect((await f.get(f.root)).json().device.status).toBe("online");
  await handle.pool.query("UPDATE telemetry.devices SET last_seen_at=now()-interval '1 hour' WHERE id=$1", [f.device]);
  expect((await f.get(f.root)).json().device.status).toBe("offline");
  await handle.pool.query("UPDATE telemetry.devices SET last_seen_at=now(),revoked_at=now() WHERE id=$1", [f.device]);
  expect((await f.get(f.root)).json().device.status).toBe("offline");
});

it("returns empty never-seen data and preserves zero-valued latest samples and exact sequences", async () => {
  const f = await fixture();
  expect(TelemetryLatest.parse((await f.get(`${f.root}/latest`)).json()).readings).toEqual([]);
  expect(TelemetryHistory.parse((await f.get(f.series())).json()).points).toEqual([]);
  await handle.pool.query("INSERT INTO telemetry.latest(device_id,channel,ts,seq,ordinal,value) VALUES($1,'temperature_c',$2,9007199254740991,0,0)", [f.device, time()]);
  expect(TelemetryLatest.parse((await f.get(`${f.root}/latest`)).json()).readings).toEqual([{ channel: "temperature_c", t: time(), v: 0, seq: "9007199254740991", ordinal: 0 }]);
});

it("reads a half-open raw window in timestamp/sequence/ordinal order without silently truncating", async () => {
  const f = await fixture();
  await f.insert(2, 10, 4, 1); await f.insert(2, 10, 3); await f.insert(1, 10, 0); await f.insert(3, 3600, 9);
  const response = await f.get(f.series());
  expect(response.statusCode).toBe(200);
  const result = TelemetryHistory.parse(response.json());
  expect(result.points.map((p) => p.v)).toEqual([0, 3, 4]);
  expect(result.pending_rollup).toBe(false);
  expect((await f.get(f.series({ limit: "2" }))).statusCode).toBe(422);
});

it("returns SQL rollup means/stats, signals stale work, and reflects recomputed late readings", async () => {
  const f = await fixture();
  await f.insert(1, 10, 2); await f.insert(2, 20, 4);
  const url = f.series({ resolution: "1h" });
  expect((await f.get(url)).json().pending_rollup).toBe(true);
  while (await processTelemetryRollups(handle.pool)) { /* drain */ }
  const result = TelemetryHistory.parse((await f.get(url)).json());
  expect(result.pending_rollup).toBe(false);
  expect(result.points).toMatchObject([{ t: time(), v: 3, n: "2", sum: "6", min: 2, max: 4, last: 4 }]);
  const minute = TelemetryHistory.parse((await f.get(f.series({ resolution: "1m" }))).json());
  expect(minute.points).toMatchObject([{ t: time(), v: 3, n: "2" }]);
  await f.insert(3, 30, 9);
  expect((await f.get(url)).json().pending_rollup).toBe(true);
  await processTelemetryRollups(handle.pool);
  expect((await f.get(url)).json().points).toMatchObject([{ v: 5, n: "3", sum: "15", last: 9 }]);
});

it("rejects malformed, unbounded, misaligned, unknown-channel and injection-like queries", async () => {
  const f = await fixture();
  const invalidQueries: Record<string, string>[] = [{ from: "yesterday" }, { from: time(3600) }, { to: time(86401) }, { limit: "2001" }, { limit: "0" }, { limit: "1.5" }, { resolution: "1d" }, { resolution: "1h", from: time(1) }, { channel: "x' OR 1=1--" }];
  for (const query of invalidQueries) {
    expect((await f.get(f.series(query))).statusCode).toBe(400);
  }
  expect((await f.get(f.series({ channel: "unknown" }))).statusCode).toBe(404);
  expect((await f.get("/v1/telemetry/devices/not-a-uuid")).statusCode).toBe(400);
  expect((await f.get("/v1/telemetry/devices?after=nope")).statusCode).toBe(400);
  expect((await f.get("/v1/telemetry/devices?limit=101")).statusCode).toBe(400);
  expect((await f.get(f.series({ channel: "unknown" }), { cookie: "" })).statusCode).toBe(401);
});

it("reports expired raw/minute ranges explicitly while preserving hourly history", async () => {
  const f = await fixture(); await f.insert(1, 10, 2);
  while (await processTelemetryRollups(handle.pool)) { /* drain */ }
  await owner.query("UPDATE telemetry.retention_state SET raw_before=$1 WHERE id=1", [time(60)]);
  try {
    expect((await f.get(f.series())).statusCode).toBe(410);
    expect((await f.get(f.series({ resolution: "1h" }))).statusCode).toBe(200);
    const old = new Date(hour.getTime() - 10 * 86400000);
    expect((await f.get(f.series({ resolution: "1m", from: old.toISOString(), to: new Date(old.getTime() + 3600000).toISOString() }))).statusCode).toBe(410);
  } finally { await owner.query("UPDATE telemetry.retention_state SET raw_before='1970-01-01T00:00:00Z' WHERE id=1"); }
});

it("uses a read-only transaction and releases the connection after authorization or storage failures", async () => {
  const f = await fixture();
  await expect(withSession(handle.pool, f.cookie, "localhost", async (client) => {
    await client.query("UPDATE telemetry.devices SET next_s=1 WHERE id=$1", [f.device]);
  })).rejects.toMatchObject({ code: "25006" });
  await owner.query("REVOKE SELECT ON telemetry.latest FROM albus_app");
  try {
    const response = await f.get(`${f.root}/latest`);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("telemetry.latest");
    expect(response.headers["cache-control"]).toBe("private, no-store");
  } finally { await owner.query("GRANT SELECT ON telemetry.latest TO albus_app"); }
  expect((await f.get(`${f.root}/latest`)).statusCode).toBe(200);
  const activity = await owner.query("SELECT 1 FROM pg_stat_activity WHERE datname='albus' AND state='idle in transaction'");
  expect(activity.rowCount).toBe(0);
});


function pauseQuery(pool: pg.Pool, matches: (sql: string) => boolean) {
  let resume!: () => void, reached!: () => void, paused = false;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const ready = new Promise<void>((resolve) => { reached = resolve; });
  const scheduled = new Proxy(pool, { get(target, property) {
    if (property === "connect") return async () => {
      const client = await target.connect();
      return new Proxy(client, { get(connection, key) {
        if (key === "query") return async (sql: string, values?: unknown[]) => {
          if (!paused && matches(sql)) { paused = true; reached(); await gate; }
          return connection.query(sql, values);
        };
        const value = Reflect.get(connection, key);
        return typeof value === "function" ? value.bind(connection) : value;
      } });
    };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { pool: scheduled, ready, resume: () => resume() };
}

it.each([
  ["move", "reader"], ["drop", "reader"], ["move", "maintenance"], ["drop", "maintenance"],
] as const)("keeps raw history complete across partition %s with %s first", async (mode, first) => {
  const f = await fixture(), offset = -((mode === "move" ? 40 : 100) + (first === "maintenance" ? 1 : 0)) * 86400;
  await owner.query("UPDATE telemetry.retention_state SET raw_before='1970-01-01' WHERE id=1");
  if (mode === "drop") await owner.query("SELECT telemetry.ensure_reading_partition($1::date)", [time(offset).slice(0, 10)]);
  await f.insert(1, offset + 10, 7);
  if (mode === "drop") while (await processTelemetryRollups(handle.pool)) { /* allow expiry */ }
  const url = f.series({ from: time(offset), to: time(offset + 3600) });
  const reader = pauseQuery(handle.pool, (sql) => first === "reader" && sql.startsWith("SELECT r.ts,r.value"));
  const maintainer = pauseQuery(owner, (sql) => first === "maintenance" && sql === "COMMIT");
  const concurrent = buildApp({ parts: { latest: async () => [] }, ping: async () => {}, telemetryPool: reader.pool, log: () => {} });
  const read = () => Promise.resolve(concurrent.inject({ url, headers: { cookie: f.cookie } }));
  // Observe outcomes immediately so assertion failures cannot leave unhandled rejections.
  const maintain = () => maintainTelemetryStorage(maintainer.pool).then((value) => ({ value }), (error: unknown) => ({ error }));
  let response: ReturnType<typeof read> | undefined;
  let maintenance: ReturnType<typeof maintain> | undefined;
  try {
    if (first === "reader") {
      response = read();
      await Promise.race([reader.ready, response.then(() => { throw new Error("Reader did not reach raw query"); })]);
      // The parent lock must allow ordinary INSERT while no maintenance is queued.
      await f.insert(2, 0, 8);
      maintenance = maintain();
    } else {
      maintenance = maintain();
      await Promise.race([maintainer.ready, maintenance.then(() => { throw new Error("Maintenance did not reach commit"); })]);
      response = read();
    }
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      blocked = (await owner.query(`SELECT 1 FROM pg_locks WHERE relation='telemetry.readings'::regclass
        AND NOT granted AND mode=$1`, [first === "reader" ? "AccessExclusiveLock" : "AccessShareLock"])).rowCount !== 0;
      if (blocked) break;
      await delay(10);
    }
    reader.resume(); maintainer.resume();
    const result = await response;
    const expectedExpiry = mode === "drop" && first === "maintenance";
    expect(result.statusCode).toBe(expectedExpiry ? 410 : 200);
    if (!expectedExpiry) expect(result.json().points).toMatchObject([{ t: time(offset + 10), v: 7 }]);
    expect(blocked).toBe(true);
    expect(await maintenance).toHaveProperty("value");
    const fresh = await f.get(url);
    expect(fresh.statusCode).toBe(mode === "drop" ? 410 : 200);
    if (mode === "move") expect(fresh.json().points).toHaveLength(1);
  } finally {
    reader.resume(); maintainer.resume();
    await response; await maintenance;
    await concurrent.close();
    await owner.query("UPDATE telemetry.retention_state SET raw_before='1970-01-01' WHERE id=1");
  }
});


it("returns 503 on a bounded parent-lock wait, then rechecks session expiry after a successful wait", async () => {
  const f = await fixture();
  const blocker = await owner.connect();
  let response: Promise<Awaited<ReturnType<typeof f.get>>> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE ONLY telemetry.readings IN ACCESS EXCLUSIVE MODE");
    // Existing 2s statement_timeout must become a controlled failure, not empty 200.
    const timedOut = await f.get(f.series());
    expect(timedOut.statusCode).toBe(503);
    expect(timedOut.headers["cache-control"]).toBe("private, no-store");
    await blocker.query("COMMIT");
    expect((await f.get(f.series())).statusCode).toBe(200);
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE ONLY telemetry.readings IN ACCESS EXCLUSIVE MODE");
    response = Promise.resolve(f.get(f.series()));
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      blocked = (await owner.query(`SELECT 1 FROM pg_locks WHERE relation='telemetry.readings'::regclass
        AND NOT granted AND mode='AccessShareLock'`)).rowCount !== 0;
      if (blocked) break;
      await delay(10);
    }
    expect(blocked).toBe(true);
    // Expire after BEGIN but before the first snapshot: transaction-start time is too old.
    await owner.query("UPDATE users.sessions SET expires_at=clock_timestamp() WHERE id=$1", [f.session]);
    await blocker.query("COMMIT");
    expect((await response).statusCode).toBe(401);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await response;
  }
});
