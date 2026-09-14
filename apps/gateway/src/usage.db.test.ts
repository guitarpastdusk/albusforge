import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { SESSION_COOKIE, UsageSummary } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "./app";
import { createAuthStore } from "./auth-store";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
let owner: pg.Pool;
let app: FastifyInstance;
const now = new Date();
const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").withTmpFs({ "/var/lib/postgresql/data": "rw,size=256m" }).start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate"); await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "migrate-secret", ssl: "disable" };
  await runMigrations(config, { appRole: { name: "albus_app", password: "app-secret" } });
  owner = createDb(config).pool;
  handle = createDb({ ...config, user: "albus_app", password: "app-secret" }, { max: 5, connectTimeoutMs: 1000, statementTimeoutMs: 2000, queryTimeoutMs: 3000 });
  app = buildApp({ parts: { latest: async () => [] }, ping: async () => {}, telemetryPool: handle.pool, log: () => {} });
});
afterAll(async () => { await app?.close(); await handle?.pool.end(); await owner?.end(); await container?.stop(); });

async function fixture() {
  const tenant = randomUUID(), user = randomUUID(), session = randomUUID(), device = randomUUID();
  const token = randomBytes(32).toString("base64url");
  await handle.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'Usage workspace')", [tenant]);
  await handle.pool.query("INSERT INTO users.users(id,email) VALUES($1,$2)", [user, `${user}@example.test`]);
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [tenant, user]);
  await handle.pool.query("INSERT INTO users.sessions(id,token_hash,user_id,active_tenant_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [session, createHash("sha256").update(token).digest("hex"), user, tenant]);
  await handle.pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,'{}','{}')", [device, tenant, randomUUID()]);
  const cookie = `${SESSION_COOKIE}=${token}`;
  const get = (url = "/v1/usage", extra: Record<string, string> = {}) => app.inject({ url, headers: { cookie, ...extra } });
  const call = async (stage = "intake", at = start, cost = "0.000001") => handle.pool.query(`INSERT INTO builds.llm_calls(tenant_id,stage,model,input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens,cost_usd,created_at)
    VALUES($1,$2,'test-model',100,20,30,40,$3,$4)`, [tenant, stage, cost, at]);
  return { tenant, user, session, device, token, cookie, get, call };
}

it("returns a zero-valued current UTC month with exact strings and no invented storage or plan charges", async () => {
  const f = await fixture();
  const response = await f.get();
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  const usage = UsageSummary.parse(response.json());
  expect(usage.period).toEqual({ start: start.toISOString(), end: end.toISOString() });
  expect(usage.model.total).toEqual({ calls: "0", input_tokens: "0", output_tokens: "0", cache_read_tokens: "0", cache_creation_tokens: "0", cost_usd: "0.000000" });
  expect(usage.model.stages).toEqual([]);
  expect(usage.telemetry).toEqual({ readings_in: "0", payload_bytes: "0" });
  expect(response.body).not.toContain("bytes_stored");
  expect(response.body).not.toContain(f.token);
});

it("aggregates stages, tokens, cache categories and stored decimal costs within the half-open month", async () => {
  const f = await fixture();
  await f.call(); await f.call("intake", new Date(end.getTime() - 1), "0.123456");
  await f.call("future-stage", start, "1.000000");
  await f.call("other", start, "2.000000");
  await f.call("intake", new Date(start.getTime() - 1), "9.000000"); await f.call("intake", end, "9.000000");
  const usage = UsageSummary.parse((await f.get()).json());
  expect(usage.model.total).toEqual({ calls: "4", input_tokens: "400", output_tokens: "80", cache_read_tokens: "120", cache_creation_tokens: "160", cost_usd: "3.123457" });
  expect(usage.model.stages).toMatchObject([{ stage: "intake", calls: "2", cost_usd: "0.123457" }, { stage: "other", calls: "2", cost_usd: "3.000000" }]);
});

it("scopes model and sensor usage to the session tenant, even with membership in another tenant", async () => {
  const a = await fixture(), b = await fixture(); await a.call(); await b.call("intake", start, "7.000000");
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'admin')", [b.tenant, a.user]);
  for (const f of [a, b]) await handle.pool.query("INSERT INTO telemetry.usage(device_id,period,readings_in,payload_bytes) VALUES($1,$2,$3,$4)", [f.device, start.toISOString().slice(0, 7), f === a ? "9007199254740993" : "42", f === a ? "9007199254740994" : "100"]);
  await handle.pool.query("INSERT INTO telemetry.usage(device_id,period,readings_in,payload_bytes) VALUES($1,'2000-01',999,999)", [a.device]);
  const usage = UsageSummary.parse((await a.get()).json());
  expect(usage.model.total.calls).toBe("1"); expect(usage.model.total.cost_usd).toBe("0.000001");
  expect(usage.telemetry).toEqual({ readings_in: "9007199254740993", payload_bytes: "9007199254740994" });
  for (const query of [`?tenant_id=${b.tenant}`, "?from=2000-01-01", "?period=2000-01"]) expect((await a.get(`/v1/usage${query}`)).statusCode).toBe(400);
  expect(UsageSummary.parse((await a.get("/v1/usage", { "x-tenant-id": b.tenant, "x-forwarded-host": "other.albusforge.ai" })).json()).model.total.cost_usd).toBe("0.000001");
});

it("requires a current session and membership, with private errors", async () => {
  const f = await fixture();
  expect((await f.get("/v1/usage", { cookie: "" })).statusCode).toBe(401);
  await owner.query("UPDATE users.sessions SET revoked_at=now() WHERE id=$1", [f.session]);
  const denied = await f.get(); expect(denied.statusCode).toBe(401); expect(denied.headers["cache-control"]).toBe("private, no-store");
  await owner.query("UPDATE users.sessions SET revoked_at=NULL WHERE id=$1", [f.session]);
  await owner.query("DELETE FROM users.tenant_members WHERE user_id=$1", [f.user]);
  expect((await f.get()).statusCode).toBe(403);
});

it("shows anonymous model usage only after the real sign-up claim and preserves it after deleting its build", async () => {
  const build = randomUUID(), anon = createHash("sha256").update(randomBytes(32)).digest("hex");
  await handle.pool.query("INSERT INTO builds.builds(id,anon_owner_hash,ask_text) VALUES($1,$2,'test')", [build, anon]);
  await handle.pool.query("INSERT INTO builds.llm_calls(build_id,anon_owner_hash,stage,model,input_tokens,cost_usd) VALUES($1,$2,'intake','test-model',7,'0.654321')", [build, anon]);
  const other = await fixture(); expect((await other.get()).json().model.total.calls).toBe("0");
  const store = createAuthStore(handle.db, { newSessionToken: () => randomBytes(32).toString("base64url"), pool: handle.pool }), email = `${randomUUID()}@example.test`;
  const code = await store.issueCode(email);
  const result = await store.verifyCode({ email, code: code.code, anonOwnerHash: anon, currentSessionToken: undefined, sessionMaxAgeS: 3600 });
  if (result.kind !== "verified") throw new Error("Claim fixture failed");
  const get = () => app.inject({ url: "/v1/usage", headers: { cookie: `${SESSION_COOKIE}=${result.sessionToken}` } });
  expect((await get()).json().model.total).toMatchObject({ calls: "1", input_tokens: "7", cost_usd: "0.654321" });
  await handle.pool.query("DELETE FROM builds.builds WHERE id=$1", [build]);
  expect((await get()).json().model.total.calls).toBe("1");
});

it("reports device deletion semantics and recovers cleanly after a storage failure", async () => {
  const f = await fixture();
  await handle.pool.query("INSERT INTO telemetry.usage(device_id,period,readings_in,payload_bytes) VALUES($1,$2,5,50)", [f.device, start.toISOString().slice(0, 7)]);
  expect((await f.get()).json().telemetry.readings_in).toBe("5");
  await handle.pool.query("DELETE FROM telemetry.devices WHERE id=$1", [f.device]);
  expect((await f.get()).json().telemetry.readings_in).toBe("0");
  await owner.query("REVOKE SELECT ON builds.llm_calls FROM albus_app");
  try { const response = await f.get(); expect(response.statusCode).toBe(500); expect(response.body).not.toContain("llm_calls"); }
  finally { await owner.query("GRANT SELECT ON builds.llm_calls TO albus_app"); }
  expect((await f.get()).statusCode).toBe(200);
  expect((await owner.query("SELECT 1 FROM pg_stat_activity WHERE datname='albus' AND state='idle in transaction'")).rowCount).toBe(0);
});
