import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { createDb, dbConfigFromEnv, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { tokenHash } from "./routes.js";
import { buildApp } from "./app.js";
import { simulatorChannels } from "./local.js";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
let owner: pg.Pool;
let app: FastifyInstance;
let cliEnv: NodeJS.ProcessEnv;
const epoch = 1_789_300_000;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "migrate-secret", ssl: "disable" };
  await runMigrations(config, { appRole: { name: "albus_app", password: "app-secret" } });
  cliEnv = { ...process.env, DB_HOST: config.host, DB_PORT: String(config.port), DB_NAME: config.database, DB_USER: "albus_app", DB_PASSWORD: "app-secret", DB_SSL: "disable" };
  owner = createDb(config).pool;
  handle = createDb({ ...config, user: "albus_app", password: "app-secret" }, { max: 5, connectTimeoutMs: 1000, statementTimeoutMs: 2000, queryTimeoutMs: 3000 });
  app = buildApp({ pool: handle.pool, now: () => new Date(epoch * 1000), log: () => {} });
});
afterAll(async () => { await app?.close(); await handle?.pool.end(); await owner?.end(); await container?.stop(); });
async function fixture() {
  const dev = randomUUID(), tenant = randomUUID(), token = randomBytes(32).toString("base64url");
  await handle.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'test')", [tenant]);
  await handle.pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,$4,$5)", [dev,tenant,tokenHash(token),simulatorChannels,{kind:"test"}]);
  const body = { v: 1, dev, seq: 1, ts: epoch, r: [{ c: "temperature_c", t: -60, v: 4.2 }, { c: "humidity_pct", t: epoch, v: 0 }], st: { up_s: 60, health: ["OK"] } };
  const send = (payload: unknown = body, bearer = token) => app.inject({ method: "POST", url: "/ingest/v1", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, payload: JSON.stringify(payload) });
  return { dev, tenant, token, body, send };
}
async function count(dev: string, table: "packets" | "readings" | "latest" | "usage") {
  return Number((await handle.pool.query(`SELECT count(*) AS n FROM telemetry.${table} WHERE device_id=$1`, [dev])).rows[0].n);
}
it("commits normalized readings, latest and UTC monthly usage as the restricted app role", async () => {
  const f = await fixture();
  const response = await f.send();
  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ ok: 2, next_s: 300, cmd: [] });
  const readings = (await handle.pool.query("SELECT channel,ts,value FROM telemetry.readings WHERE device_id=$1 ORDER BY ordinal", [f.dev])).rows;
  expect(readings[0].ts.toISOString()).toBe(new Date((epoch - 60) * 1000).toISOString());
  expect(readings[1].value).toBe(0); // Zero humidity is valid, not a sensor-fault heuristic.
  const usage = (await handle.pool.query("SELECT * FROM telemetry.usage WHERE device_id=$1", [f.dev])).rows[0];
  expect(Number(usage.readings_in)).toBe(2);
  expect(Number(usage.payload_bytes)).toBe(Buffer.byteLength(JSON.stringify(f.body)));
  expect(usage.period).toBe(new Date(epoch * 1000).toISOString().slice(0, 7));
  expect(await count(f.dev, "latest")).toBe(2);
});
it("concurrent duplicate packets commit once and return the same ack", async () => {
  const f = await fixture();
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.send()));
  expect(responses.map((r) => r.statusCode)).toEqual(Array(8).fill(202));
  expect(await count(f.dev, "packets")).toBe(1);
  expect(await count(f.dev, "readings")).toBe(2);
  expect((await handle.pool.query("SELECT readings_in FROM telemetry.usage WHERE device_id=$1", [f.dev])).rows[0].readings_in).toBe("2");
});
it("rejects changed payloads reusing a committed sequence", async () => {
  const f = await fixture(); await f.send();
  expect((await f.send({ ...f.body, st: { up_s: 61, health: ["OK"] } })).statusCode).toBe(409);
  expect(await count(f.dev, "readings")).toBe(2);
});
it("accepts object-key reordering on a retry", async () => {
  const f = await fixture(); await f.send();
  expect((await f.send(Object.fromEntries(Object.entries(f.body).reverse()))).statusCode).toBe(202);
});
it("isolates device credentials, rejects tenant spoofing and revocation even on retries", async () => {
  const a = await fixture(), b = await fixture();
  expect((await a.send(a.body, b.token)).statusCode).toBe(401);
  expect((await a.send({ ...a.body, tenant_id: b.tenant })).statusCode).toBe(400);
  expect(await count(a.dev, "packets")).toBe(0);
  await a.send();
  await handle.pool.query("UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1", [a.dev]);
  expect((await a.send()).statusCode).toBe(401);
  expect(await count(b.dev, "readings")).toBe(0);
});
it("rejects undeclared channels, ranges and invalid timestamps without partial writes", async () => {
  const f = await fixture();
  for (const r of [{ c: "other", t: epoch, v: 1 }, { c: "constructor", t: epoch, v: 1 }, { c: "humidity_pct", t: epoch, v: 101 }, { c: "humidity_pct", t: epoch - 90 * 86400 - 1, v: 50 }, { c: "humidity_pct", t: epoch + 1, v: 50 }]) {
    expect((await f.send({ ...f.body, r: [...f.body.r, r] })).statusCode).toBe(422);
  }
  for (const table of ["packets", "readings", "latest", "usage"] as const) expect(await count(f.dev, table)).toBe(0);
});
it("backfill never replaces newer latest values or status; same-time ties use sequence then ordinal", async () => {
  const f = await fixture();
  await f.send({ ...f.body, seq: 10 });
  await f.send({ ...f.body, seq: 2, r: [{ c: "temperature_c", t: epoch - 120, v: 8 }], st: { up_s: 1, health: ["OLD"] } });
  const device = (await handle.pool.query("SELECT last_seq,status FROM telemetry.devices WHERE id=$1", [f.dev])).rows[0];
  expect(device.last_seq).toBe("10"); expect(device.status.health).toEqual(["OK"]);
  expect((await handle.pool.query("SELECT value FROM telemetry.latest WHERE device_id=$1 AND channel='temperature_c'", [f.dev])).rows[0].value).toBe(4.2);
  await f.send({ ...f.body, seq: 11, r: [{ c: "temperature_c", t: epoch - 60, v: 5 }, { c: "temperature_c", t: epoch - 60, v: 6 }] });
  expect((await handle.pool.query("SELECT value FROM telemetry.latest WHERE device_id=$1 AND channel='temperature_c'", [f.dev])).rows[0].value).toBe(6);
});
it("rolls back every write and returns 503 on a late storage failure; retry succeeds", async () => {
  const f = await fixture();
  await owner.query("REVOKE INSERT ON telemetry.usage FROM albus_app");
  try {
    const response = await f.send();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "storage_unavailable", message: "Telemetry storage unavailable" } });
    for (const table of ["packets", "readings", "latest", "usage"] as const) expect(await count(f.dev, table)).toBe(0);
    expect((await handle.pool.query("SELECT last_seq FROM telemetry.devices WHERE id=$1", [f.dev])).rows[0].last_seq).toBeNull();
  } finally { await owner.query("GRANT INSERT ON telemetry.usage TO albus_app"); }
  expect((await f.send()).statusCode).toBe(202);
});
it("validates body limits, finite numbers and required status; exposes health checks", async () => {
  const f = await fixture();
  expect((await f.send({ ...f.body, st: undefined })).statusCode).toBe(400);
  expect((await f.send({ ...f.body, r: [{ c: "temperature_c", t: epoch, v: null }] })).statusCode).toBe(400);
  expect((await f.send({ ...f.body, seq: Number.MAX_SAFE_INTEGER + 1 })).statusCode).toBe(400);
  expect((await f.send({ ...f.body, r: Array(501).fill(f.body.r[0]) })).statusCode).toBe(400);
  expect((await f.send({ padding: "x".repeat(130 * 1024) })).statusCode).toBe(413);
  expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
  expect((await app.inject({ url: "/readyz" })).statusCode).toBe(200);
});

it("runs the local provision and simulator CLIs over real HTTP, retaining one packet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "albus-telemetry-test-"));
  const file = join(dir, "device.json");
  const live = buildApp({ pool: handle.pool, log: () => {} });
  const run = promisify(execFile);
  try {
    const provision = await run("pnpm", ["exec", "tsx", "src/provision.ts", file], { env: cliEnv });
    const credential = JSON.parse(await readFile(file, "utf8"));
    expect(provision.stdout).not.toContain(credential.token);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(run("pnpm", ["exec", "tsx", "src/provision.ts", file], { env: cliEnv })).rejects.toThrow();
    const origin = await live.listen({ host: "127.0.0.1", port: 0 });
    const simulated = await run("pnpm", ["exec", "tsx", "src/simulate.ts", file, origin, "1"]);
    const lines = simulated.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const [i, line] of lines.entries()) {
      expect(line).toMatch(new RegExp(`^Attempt ${i + 1}: 202 `));
      expect(JSON.parse(line.slice(line.indexOf("{")))).toEqual({ ok: 2, next_s: 300, cmd: [] });
    }
    expect(simulated.stdout).not.toContain(credential.token);
    expect(await count(credential.dev, "packets")).toBe(1);
    expect(await count(credential.dev, "readings")).toBe(2);
  } finally {
    await live.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("deduplicates retries across independent service instances and SQL pools", async () => {
  const f = await fixture();
  const secondDb = createDb(dbConfigFromEnv(cliEnv), { max: 2, connectTimeoutMs: 1000, statementTimeoutMs: 2000, queryTimeoutMs: 3000 });
  const second = buildApp({ pool: secondDb.pool, now: () => new Date(epoch * 1000), log: () => {} });
  try {
    const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => i % 2 === 0 ? f.send() : second.inject({ method: "POST", url: "/ingest/v1", headers: { authorization: `Bearer ${f.token}` }, payload: f.body })));
    expect(replies.map((r) => r.statusCode)).toEqual(Array(8).fill(202));
    expect(await count(f.dev, "packets")).toBe(1);
    expect(await count(f.dev, "readings")).toBe(2);
    expect((await handle.pool.query("SELECT readings_in FROM telemetry.usage WHERE device_id=$1", [f.dev])).rows[0].readings_in).toBe("2");
  } finally { await second.close(); await secondDb.pool.end(); }
});

it("rejects data behind the storage retention boundary without a receipt or partial writes", async () => {
  const f = await fixture();
  await owner.query("UPDATE telemetry.retention_state SET raw_before=$1 WHERE id=1", [new Date((epoch + 1) * 1000)]);
  try {
    expect((await f.send()).statusCode).toBe(422);
    expect(await count(f.dev, "packets")).toBe(0);
    expect(await count(f.dev, "readings")).toBe(0);
  } finally { await owner.query("UPDATE telemetry.retention_state SET raw_before='1970-01-01 00:00:00+00' WHERE id=1"); }
});
