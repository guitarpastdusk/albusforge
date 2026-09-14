import { randomUUID } from "node:crypto";
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { DeviceConverseRequest } from "@albusforge/schema";
import { createConverseStore } from "./converse-store";
import { AskError } from "./errors";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
let owner: pg.Pool;

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
});
afterAll(async () => { await handle?.pool.end(); await owner?.end(); await container?.stop(); });

async function fixture() {
  const tenant_id = randomUUID(), actor_id = randomUUID(), device_id = randomUUID();
  await handle.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'test')", [tenant_id]);
  await handle.pool.query("INSERT INTO users.users(id,email) VALUES($1,$2)", [actor_id, `${actor_id}@example.test`]);
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [tenant_id, actor_id]);
  await handle.pool.query(
    `INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source,display_name,next_s,last_seen_at,status)
     VALUES($1,$2,$3,'{"temperature":{"unit":"C","min":-40,"max":85},"humidity":{"unit":"%","min":0,"max":100}}','{}','Plant A',300,now(),'{"health":["OK"],"batt_mv":3810}')`,
    [device_id, tenant_id, randomUUID()],
  );
  const hour = Math.floor(Date.now() / 3600000) * 3600000;
  const from = new Date(hour - 3600000).toISOString();
  const to = new Date(hour).toISOString();
  const q: DeviceConverseRequest = { tenant_id, actor_id, device_id, request_id: randomUUID(), question: "how warm?", history: [] };
  const insert = (seq: number, offsetS: number, value: number, channel = "temperature") =>
    handle.pool.query(`INSERT INTO telemetry.readings(device_id,seq,ordinal,channel,ts,value) VALUES($1,$2,0,$3,$4,$5)`,
      [device_id, seq, channel, new Date(Date.parse(from) + offsetS * 1000), value]);
  const rollup = (bucket: string, resolution: "1m" | "1h", n: number, sum: number, min: number, max: number) =>
    handle.pool.query(`INSERT INTO telemetry.rollups(device_id,channel,resolution,bucket,n,sum,min,max,last,stddev)
      VALUES($1,'temperature',$2,$3,$4,$5,$6,$7,$7,0)`, [device_id, resolution, bucket, n, sum, min, max]);
  return { q, from, to, insert, rollup, device_id, tenant_id };
}
const store = (limits = { user: 100, tenant: 100, global: 1000 }) => createConverseStore(handle.pool, limits);

it("describes the device from the registry-derived channels, with units and latest values", async () => {
  const { q, insert } = await fixture();
  await insert(1, 10, 21.5);
  await handle.pool.query(`INSERT INTO telemetry.latest(device_id,channel,ts,seq,ordinal,value)
    VALUES($1,'temperature',now(),1,0,21.5)`, [q.device_id]);
  const context = await store().context(q);
  expect(context.display_name).toBe("Plant A");
  expect(context.status).toBe("online");
  expect(context.health).toMatchObject({ batt_mv: 3810 });
  expect(context.channels.map((c) => [c.channel, c.unit])).toEqual([["humidity", "%"], ["temperature", "C"]].sort());
  expect(context.channels.find((c) => c.channel === "temperature")?.latest?.v).toBe(21.5);
  // A provisioned channel with no reading is reported as such, never as zero.
  expect(context.channels.find((c) => c.channel === "humidity")?.latest).toBeNull();
});

it("refuses a device in another tenant, and one this actor is not a member of", async () => {
  const { q } = await fixture();
  await expect(store().context({ ...q, tenant_id: randomUUID() })).rejects.toBeInstanceOf(AskError);
  await expect(store().context({ ...q, actor_id: randomUUID() })).rejects.toBeInstanceOf(AskError);
});

it("aggregates a half-open window, excluding the end and other channels", async () => {
  const { q, from, to, insert } = await fixture();
  await insert(3, 20, 6);
  await insert(1, 0, 0);
  await insert(2, 10, 3);
  await insert(4, 3600, 80); // exactly `to`: excluded
  await insert(5, 30, 99, "humidity"); // other channel: excluded
  const facts = await store().window(q, { channel: "temperature", from, to });
  expect(facts).toMatchObject({ unit: "C", count: 3, min: 0, max: 6, mean: 3 });
  expect(facts.latest).toEqual({ t: new Date(Date.parse(from) + 20000).toISOString(), v: 6 });
});

it("reports an empty window as zero readings rather than failing", async () => {
  const { q, from, to } = await fixture();
  const facts = await store().window(q, { channel: "temperature", from, to });
  expect(facts).toMatchObject({ count: 0, min: null, max: null, mean: null, latest: null });
});

it("rejects a channel this device does not have, and an inverted or excessive window", async () => {
  const { q, from, to } = await fixture();
  await expect(store().window(q, { channel: "pressure", from, to })).rejects.toMatchObject({ code: "NO_SUCH_CHANNEL" });
  await expect(store().window(q, { channel: "temperature", from: to, to: from })).rejects.toMatchObject({ code: "BAD_WINDOW" });
  const wide = new Date(Date.parse(to) + 40 * 86400_000).toISOString();
  await expect(store().window(q, { channel: "temperature", from, to: wide })).rejects.toMatchObject({ code: "WINDOW_TOO_WIDE" });
});

it("reads rollup buckets and reports their means without recomputing from raw", async () => {
  const { q, from, to, rollup } = await fixture();
  await rollup(from, "1h", 4, 84, 20, 25);
  const series = await store().series(q, { channel: "temperature", from, to, resolution: "1h" });
  expect(series.resolution).toBe("1h");
  expect(series.points).toEqual([{ t: from, mean: 21, min: 20, max: 25, n: 4 }]);
  expect(series.truncated).toBe(false);
});

it("keeps a series result small enough to re-send on every loop iteration", async () => {
  const { q, from, rollup } = await fixture();
  const minutes = 250;
  for (let i = 0; i < minutes; i++) await rollup(new Date(Date.parse(from) + i * 60000).toISOString(), "1m", 1, 20, 20, 20);
  const to = new Date(Date.parse(from) + minutes * 60000).toISOString();
  const series = await store().series(q, { channel: "temperature", from, to, resolution: "1m" });
  expect(series.points).toHaveLength(200);
  expect(series.truncated).toBe(true);
});

it("admits a turn, then refuses the next once the actor's daily allowance is spent", async () => {
  const { q } = await fixture();
  const limited = store({ user: 1, tenant: 100, global: 1000 });
  await limited.reserve(q);
  await expect(limited.reserve({ ...q, request_id: randomUUID() })).rejects.toMatchObject({ status: 429, code: "DAILY_LIMIT" });
});

it("refuses a replayed request id rather than charging for it twice", async () => {
  const { q } = await fixture();
  await store().reserve(q);
  await expect(store().reserve(q)).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
});

it("reports the widest exhausted scope first, so an operator can tell tenant from platform", async () => {
  const { q } = await fixture();
  await expect(store({ user: 0, tenant: 0, global: 0 }).reserve(q)).rejects.toMatchObject({ scope: "global" });
  await expect(store({ user: 0, tenant: 0, global: 1000 }).reserve(q)).rejects.toMatchObject({ scope: "tenant" });
  await expect(store({ user: 0, tenant: 100, global: 1000 }).reserve(q)).rejects.toMatchObject({ scope: "actor" });
});

it("records what the whole loop cost, not just its last call", async () => {
  const { q } = await fixture();
  await store().reserve(q);
  await store().started(q);
  await store().finish(q, "model", { model: "claude-sonnet-5", modelCalls: 3, toolCalls: 4, usageKnown: true,
    inputTokens: 900, outputTokens: 120, cacheReadTokens: 800, cacheCreationTokens: 0, costUsd: 0.0042 });
  const row = (await handle.pool.query("SELECT * FROM telemetry.device_chat_requests WHERE request_id=$1", [q.request_id])).rows[0];
  expect(row).toMatchObject({ outcome: "model", model: "claude-sonnet-5", model_calls: 3, tool_calls: 4,
    usage_known: true, input_tokens: 900, output_tokens: 120 });
  expect(Number(row.cost_usd)).toBeCloseTo(0.0042, 6);
});

it("nulls the token columns when a call was attempted but its usage never came back", async () => {
  const { q } = await fixture();
  await store().reserve(q);
  await store().started(q);
  await store().finish(q, "unavailable", { model: null, modelCalls: 1, toolCalls: 0, usageKnown: false,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 });
  const row = (await handle.pool.query("SELECT usage_known,input_tokens,cost_usd FROM telemetry.device_chat_requests WHERE request_id=$1", [q.request_id])).rows[0];
  // Recording zero would understate real spend; unknown is the honest value.
  expect(row).toMatchObject({ usage_known: false, input_tokens: null, cost_usd: null });
});

it("keeps usage known when no model was ever attempted", async () => {
  const { q } = await fixture();
  await store().reserve(q);
  await store().finish(q, "unavailable", { model: null, modelCalls: 0, toolCalls: 0, usageKnown: true,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 });
  const row = (await handle.pool.query("SELECT usage_known,cost_usd FROM telemetry.device_chat_requests WHERE request_id=$1", [q.request_id])).rows[0];
  expect(row.usage_known).toBe(true);
  expect(Number(row.cost_usd)).toBe(0);
});
