import { createTestDb as createDb, closeTestPool } from "./test-pool-shutdown";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { DeviceSetupStatus, SESSION_COOKIE } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "./app";
import { buildApp as buildIngest } from "../../cloudlink/src/app";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
let app: ReturnType<typeof buildApp>;
let ingest: ReturnType<typeof buildIngest>;
const logs: string[] = [];
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").withTmpFs({ "/var/lib/postgresql/data": "rw,size=256m" }).start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'local-migrate'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "local-migrate", ssl: "disable" };
  await runMigrations(config, { appRole: { name: "albus_app", password: "local-app" } });
  handle = createDb({ ...config, user: "albus_app", password: "local-app" }, { max: 5, connectTimeoutMs: 1000, statementTimeoutMs: 2000, queryTimeoutMs: 3000 });
  app = buildApp({ parts: { latest: async () => [] }, ping: async () => {}, telemetryPool: handle.pool, log: (level, message, context) => logs.push(JSON.stringify({ level, message, context })) });
  ingest = buildIngest({ pool: handle.pool, log: entry => logs.push(JSON.stringify(entry)) });
});
afterAll(async () => { await app?.close(); await ingest?.close(); await closeTestPool(handle?.pool); await container?.stop(); });
async function fixture() {
  const tenant = randomUUID(), user = randomUUID(), id = randomUUID(), session = randomUUID();
  const sessionToken = randomBytes(32).toString("base64url"), token = randomBytes(32).toString("base64url");
  await handle.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'Setup fixture')", [tenant]);
  await handle.pool.query("INSERT INTO users.users(id,email) VALUES($1,$2)", [user, `${user}@example.test`]);
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [tenant, user]);
  await handle.pool.query("INSERT INTO users.sessions(id,user_id,active_tenant_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [session, user, tenant, hash(sessionToken)]);
  await handle.pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source,next_s) VALUES($1,$2,$3,$4,$5,60)", [id, tenant, hash(token), { temperature: { unit: "C", min: -40, max: 85 }, humidity: { unit: "%", min: 0, max: 100 } }, { private: "never expose source", kind: "test fixture, not a BuildPlan" }]);
  const cookie = `${SESSION_COOKIE}=${sessionToken}`;
  const url = `/v1/devices/${id}/setup`;
  const get = () => app.inject({ url, headers: { cookie } });
  const send = (seq: number, channel: string, value: number, bearer = token) => {
    const ts = Math.floor(Date.now() / 1000);
    return ingest.inject({ method: "POST", url: "/ingest/v1", headers: { authorization: `Bearer ${bearer}` }, payload: { v: 1, dev: id, seq, ts, r: [{ c: channel, t: ts - 60, v: value }], st: { up_s: 120, health: [] } } });
  };
  return { tenant, user, id, session, token, sessionToken, cookie, url, get, send };
}
it("requires a current session and tenant membership, with opaque foreign-device refusal and no-store errors", async () => {
  const a = await fixture(), b = await fixture();
  for (const cookie of ["", `__Host-albus_anon=${a.sessionToken}`, `${SESSION_COOKIE}=${a.token}`]) {
    const response = await app.inject({ url: a.url, headers: { cookie } });
    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("private, no-store");
  }
  const foreign = await app.inject({ url: a.url, headers: { cookie: b.cookie } });
  const missing = await app.inject({ url: `/v1/devices/${randomUUID()}/setup`, headers: { cookie: b.cookie } });
  expect(foreign.statusCode).toBe(404);
  expect(foreign.json()).toEqual(missing.json());
  await handle.pool.query("DELETE FROM users.tenant_members WHERE tenant_id=$1 AND user_id=$2", [a.tenant, a.user]);
  expect((await a.get()).statusCode).toBe(403);
  await handle.pool.query("UPDATE users.sessions SET revoked_at=now() WHERE id=$1", [b.session]);
  expect((await b.get()).statusCode).toBe(401);
});
it("confirms only durable authenticated ingestion, distinguishes missing channels, and preserves zero samples", async () => {
  const f = await fixture();
  const initial = await f.get();
  expect(initial.headers["cache-control"]).toBe("private, no-store");
  expect(DeviceSetupStatus.parse(initial.json())).toMatchObject({ state: "waiting_for_upload", packet_received: false, last_packet_at: null, channels: [{ key: "humidity", latest: null }, { key: "temperature", latest: null }] });
  expect((await f.send(1, "temperature", 23, randomBytes(32).toString("base64url"))).statusCode).toBe(401);
  expect((await f.get()).json().state).toBe("waiting_for_upload");
  expect((await f.send(1, "temperature", 23)).statusCode).toBe(202);
  expect(DeviceSetupStatus.parse((await f.get()).json())).toMatchObject({ state: "waiting_for_channels", packet_received: true, channels: [{ key: "humidity", latest: null }, { key: "temperature", latest: { value: 23 } }] });
  expect((await f.send(2, "humidity", 0)).statusCode).toBe(202);
  const final = await f.get();
  const state = DeviceSetupStatus.parse(final.json());
  expect(state.state).toBe("confirmed");
  expect(state.last_packet_at).not.toBeNull();
  expect(state.channels[0]?.latest?.value).toBe(0);
  for (const secret of [f.token, hash(f.token), f.sessionToken, "never expose source", "token_hash", "source"]) expect(final.body).not.toContain(secret);
  for (const secret of [f.token, f.sessionToken, "never expose source"]) expect(logs.join("\n")).not.toContain(secret);
  await handle.pool.query("UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1", [f.id]);
  expect((await f.get()).json()).toMatchObject({ state: "credential_revoked", packet_received: true });
  expect((await f.send(3, "temperature", 24)).statusCode).toBe(401);
});
it("does not mistake seeded latest rows for an accepted upload, rejects extra query fields, and never mints an identity", async () => {
  const f = await fixture();
  await handle.pool.query("INSERT INTO telemetry.latest(device_id,channel,ts,value,seq,ordinal) VALUES($1,'temperature',now(),20,1,0)", [f.id]);
  expect((await f.get()).json()).toMatchObject({ state: "waiting_for_upload", packet_received: false });
  expect((await app.inject({ url: `${f.url}?tenant_id=${f.tenant}`, headers: { cookie: f.cookie } })).statusCode).toBe(400);
  expect((await app.inject({ url: "/v1/devices/not-a-uuid/setup", headers: { cookie: f.cookie } })).statusCode).toBe(400);
  expect((await handle.pool.query("SELECT token_hash,source FROM telemetry.devices WHERE id=$1", [f.id])).rows[0]).toEqual({ token_hash: hash(f.token), source: { private: "never expose source", kind: "test fixture, not a BuildPlan" } });
});
