import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { DeviceConfigV1, DeviceProvisioning, TelemetryEnvelope } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "./app";
import { buildApp as buildIngest } from "../../cloudlink/src/app";
import { parseHandoffKeys } from "./device-credential";
import { provisioningFixtureModel, provisioningUser, seedProvisioningFixture } from "./provisioning.test-fixtures";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
let app: ReturnType<typeof buildApp>;
let ingest: ReturnType<typeof buildIngest>;
const logs: string[] = [];
const keys = parseHandoffKeys(JSON.stringify({ active: "test", keys: { test: randomBytes(32).toString("base64url") } }))!;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() }); await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'local-migrate'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate"); await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "local-migrate", ssl: "disable" };
  await runMigrations(config, { appRole: { name: "albus_app", password: "local-app" } });
  handle = createDb({ ...config, user: "albus_app", password: "local-app" }, { max: 8, connectTimeoutMs: 1000, statementTimeoutMs: 4000, queryTimeoutMs: 5000 });
  app = buildApp({ parts: { latest: async () => [] }, ping: async () => {}, telemetryPool: handle.pool,
    deviceProvisioning: { keys, ingestUrl: "https://ingest.example.test/ingest/v1", profiles: [provisioningFixtureModel().profile] },
    log: (level, message, context) => logs.push(JSON.stringify({ level, message, context })) });
  ingest = buildIngest({ pool: handle.pool, log: entry => logs.push(JSON.stringify(entry)) });
});
afterAll(async () => { await app?.close(); await ingest?.close(); await handle?.pool.end(); await container?.stop(); });
async function fixture(role = "admin") {
  const user = await provisioningUser(handle.pool, role), plan = await seedProvisioningFixture(handle.pool, user.tenantId, user.userId);
  const body = { build_id: plan.buildId, plan_version: 1, code_version: 1, request_id: randomUUID(), expected_tenant_id: user.tenantId };
  const post = (url: string, payload: object, cookie = user.cookie) => app.inject({ method: "POST", url, payload, headers: { cookie, origin: "http://localhost" } });
  const claim = () => post("/v1/devices/claim", body);
  const request = (version = 1) => ({ expected_version: version, expected_tenant_id: user.tenantId });
  return { ...user, ...plan, body, post, claim, request };
}
const send = (config: DeviceConfigV1, seq = config.seq_start) => {
  const ts = Math.floor(Date.now() / 1000);
  return ingest.inject({ method: "POST", url: "/ingest/v1", headers: { authorization: `Bearer ${config.token}` }, payload: { v: 1, dev: config.device_id, seq, ts, r: [{ c: "illuminance", t: ts, v: 0 }], st: { up_s: 1, health: [] } } });
};
it("applies the actual migration chain and makes concurrent claims/downloads retry-safe without plaintext persistence", async () => {
  const f = await fixture();
  const claims = await Promise.all([f.claim(), f.claim()]);
  expect(claims.map(response => response.statusCode)).toEqual([200, 200]);
  const state = DeviceProvisioning.parse(claims[0]!.json()); expect(DeviceProvisioning.parse(claims[1]!.json()).device_id).toBe(state.device_id);
  expect(state).toMatchObject({ state: "configuration_ready", handoff_available: true, credential_version: 1 });
  expect((await handle.pool.query("SELECT count(*)::int n FROM telemetry.device_provisionings WHERE build_id=$1", [f.buildId])).rows[0].n).toBe(1);
  const before = (await handle.pool.query("SELECT token_hash,source FROM telemetry.devices WHERE id=$1", [state.device_id])).rows[0];
  const downloads = await Promise.all([f.post(`/v1/devices/${state.device_id}/configuration`, f.request()), f.post(`/v1/devices/${state.device_id}/configuration`, f.request())]);
  expect(downloads.map(response => response.statusCode).sort()).toEqual([200, 410]);
  const delivered = downloads.find(response => response.statusCode === 200)!;
  expect(delivered.headers["cache-control"]).toBe("private, no-store"); expect(delivered.headers["content-disposition"]).toContain("attachment");
  const config = DeviceConfigV1.parse(delivered.json()); expect(digest(config.token)).toBe(before.token_hash);
  const persisted = (await handle.pool.query("SELECT handoff_ciphertext,handoff_key_id FROM telemetry.device_provisionings WHERE device_id=$1", [state.device_id])).rows[0];
  expect(persisted).toEqual({ handoff_ciphertext: null, handoff_key_id: null });
  expect((await send(config, 7)).statusCode).toBe(202);
  const setup = await app.inject({ url: `/v1/devices/${state.device_id}/setup`, headers: { cookie: f.cookie } }); expect(setup.json().state).toBe("confirmed");
  const replacement = { ...f.request(), request_id: randomUUID() };
  const replacements = await Promise.all([f.post(`/v1/devices/${state.device_id}/configuration/replace`, replacement), f.post(`/v1/devices/${state.device_id}/configuration/replace`, replacement)]);
  expect(replacements.map(response => response.statusCode)).toEqual([200, 200]); expect(replacements.map(response => response.json().credential_version)).toEqual([2, 2]);
  expect((await send(config, 8)).statusCode).toBe(401);
  const newConfig = DeviceConfigV1.parse((await f.post(`/v1/devices/${state.device_id}/configuration`, f.request(2))).json());
  expect(newConfig.seq_start).toBe(8); expect(newConfig.token).not.toBe(config.token); expect((await send(newConfig)).statusCode).toBe(202);
  expect((await f.post(`/v1/devices/${state.device_id}/credential/revoke`, f.request(2))).json().state).toBe("credential_revoked");
  expect((await send(newConfig, 9)).statusCode).toBe(401);
  expect((await f.post(`/v1/devices/${state.device_id}/configuration/replace`, { ...f.request(2), request_id: randomUUID() })).statusCode).toBe(409);
  const read = await app.inject({ url: `/v1/devices/${state.device_id}/provisioning`, headers: { cookie: f.cookie } });
  for (const secret of [config.token, newConfig.token, before.token_hash, "handoff_ciphertext", "source"]) { expect(read.body).not.toContain(secret); expect(claims[0]!.body).not.toContain(secret); expect(logs.join("\n")).not.toContain(secret); }
});
it("refuses viewers, stale workspace submissions, foreign builds, extra provisioning facts and cross-origin mutations", async () => {
  const viewer = await fixture("viewer"); expect((await viewer.claim()).statusCode).toBe(403);
  const a = await fixture(), b = await fixture();
  expect((await a.post("/v1/devices/claim", { ...a.body, expected_tenant_id: b.tenantId })).statusCode).toBe(409);
  expect((await b.post("/v1/devices/claim", { ...a.body, expected_tenant_id: b.tenantId })).statusCode).toBe(404);
  expect((await a.post("/v1/devices/claim", { ...a.body, channels: { invented: {} } })).statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: "/v1/devices/claim", payload: a.body, headers: { cookie: a.cookie, origin: "https://evil.example" } })).statusCode).toBe(403);
  expect((await a.post("/v1/devices/claim", a.body, "")).statusCode).toBe(401);
  expect((await handle.pool.query("SELECT count(*)::int n FROM telemetry.device_provisionings WHERE build_id=ANY($1::uuid[])", [[a.buildId, b.buildId, viewer.buildId]])).rows[0].n).toBe(0);
});
it("requires a current accepted plan, active immutable evidence, exact passed firmware and an approved channel profile", async () => {
  const stale = await fixture(); await handle.pool.query("INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,2,$2,1)", [stale.buildId, stale.spec]); expect((await stale.claim()).json().error.code).toBe("PLAN_STALE");
  const unaccepted = await fixture(); await handle.pool.query("UPDATE builds.plans SET accepted_at=NULL,accepted_by=NULL WHERE build_id=$1", [unaccepted.buildId]); expect((await unaccepted.claim()).json().error.code).toBe("PLAN_NOT_ACCEPTED");
  const draft = await fixture(); draft.metadata.evidence.parts[0]!.status = "draft"; await handle.pool.query("UPDATE builds.plans SET metadata=$2 WHERE build_id=$1", [draft.buildId, draft.metadata]); expect((await draft.claim()).json().error.code).toBe("PROVISIONING_UNAVAILABLE");
  const failed = await fixture(); await handle.pool.query("UPDATE builds.code_bundles SET status='failed' WHERE build_id=$1", [failed.buildId]); expect((await failed.claim()).json().error.code).toBe("FIRMWARE_NOT_READY");
  const corrupt = await fixture(); corrupt.firmware.manifest_digest = "0".repeat(64); await handle.pool.query("UPDATE builds.code_bundles SET compile_log=$2 WHERE build_id=$1", [corrupt.buildId, corrupt.firmware]); expect((await corrupt.claim()).json().error.code).toBe("FIRMWARE_NOT_READY");
  const none = await fixture(); const disabled = buildApp({ parts: { latest: async () => [] }, ping: async () => {}, telemetryPool: handle.pool, deviceProvisioning: { keys, ingestUrl: "https://ingest.example.test/ingest/v1", profiles: [] }, log: () => {} });
  try { expect((await disabled.inject({ method: "POST", url: "/v1/devices/claim", payload: none.body, headers: { cookie: none.cookie, origin: "http://localhost" } })).json().error.code).toBe("PROVISIONING_UNAVAILABLE"); } finally { await disabled.close(); }
});
it("binds downloads to the issuing session family, expires handoffs and permits explicit owner recovery", async () => {
  const f = await fixture(), id = (await f.claim()).json().device_id;
  const otherToken = randomBytes(32).toString("base64url"), otherSession = randomUUID();
  await handle.pool.query("INSERT INTO users.sessions(id,user_id,active_tenant_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [otherSession, f.userId, f.tenantId, digest(otherToken)]);
  const otherCookie = `__Host-albus_session=${otherToken}`;
  expect((await f.post(`/v1/devices/${id}/configuration`, f.request(), otherCookie)).statusCode).toBe(403);
  expect((await app.inject({ url: `/v1/devices/${id}/provisioning`, headers: { cookie: otherCookie } })).json().handoff_available).toBe(false);
  await handle.pool.query("UPDATE telemetry.device_provisionings SET handoff_expires_at=now()-interval '1 second' WHERE device_id=$1", [id]);
  expect((await f.post(`/v1/devices/${id}/configuration`, f.request())).statusCode).toBe(410);
  const replaced = await f.post(`/v1/devices/${id}/configuration/replace`, { ...f.request(), request_id: randomUUID() }, otherCookie); expect(replaced.statusCode).toBe(200);
  const childToken = randomBytes(32).toString("base64url");
  await handle.pool.query("INSERT INTO users.sessions(user_id,active_tenant_id,token_hash,expires_at,parent_session_id) VALUES($1,$2,$3,now()+interval '1 day',$4)", [f.userId, f.tenantId, digest(childToken), otherSession]);
  expect((await f.post(`/v1/devices/${id}/configuration`, f.request(2), `__Host-albus_session=${childToken}`)).statusCode).toBe(200);
  await handle.pool.query("UPDATE users.sessions SET revoked_at=now() WHERE id=$1", [otherSession]);
  expect((await f.post(`/v1/devices/${id}/configuration/replace`, { ...f.request(2), request_id: randomUUID() }, `__Host-albus_session=${childToken}`)).statusCode).toBe(401);
});
async function waitForLock(fragment: string) {
  for (let i = 0; i < 100; i++) {
    if ((await handle.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1", [`%${fragment}%`])).rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Expected fixture row-lock wait did not occur");
}
it("rechecks expiry after a build wait and serializes admitted claims before root revocation", async () => {
  const expired = await fixture();
  const blocker = await handle.pool.connect();
  try {
    await handle.pool.query("UPDATE users.sessions SET expires_at=now()+interval '600 milliseconds' WHERE id=$1", [expired.sessionId]);
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM builds.builds WHERE id=$1 FOR UPDATE", [expired.buildId]);
    const pending = expired.claim().then(response => response);
    await waitForLock("SELECT id FROM builds.builds"); await new Promise(resolve => setTimeout(resolve, 700));
    await blocker.query("COMMIT"); expect((await pending).statusCode).toBe(401);
    expect((await handle.pool.query("SELECT count(*)::int n FROM telemetry.device_provisionings WHERE build_id=$1", [expired.buildId])).rows[0].n).toBe(0);
    const admitted = await fixture();
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM builds.builds WHERE id=$1 FOR UPDATE", [admitted.buildId]);
    const accepted = admitted.claim().then(response => response); await waitForLock("SELECT id FROM builds.builds");
    const revoke = handle.pool.query("UPDATE users.sessions SET revoked_at=now() WHERE id=$1", [admitted.sessionId]);
    await waitForLock("UPDATE users.sessions SET revoked_at");
    await blocker.query("COMMIT"); const result = await accepted; expect(result.statusCode).toBe(200); await revoke;
    expect((await admitted.post(`/v1/devices/${result.json().device_id}/configuration`, admitted.request())).statusCode).toBe(401);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
});
it("a revocation or demotion that wins admission prevents any identity issuance", async () => {
  const revoked = await fixture(), demoted = await fixture();
  const blocker = await handle.pool.connect();
  try {
    await blocker.query("BEGIN"); await blocker.query("UPDATE users.sessions SET revoked_at=now() WHERE id=$1", [revoked.sessionId]);
    const pending = revoked.claim().then(response => response); await waitForLock("WITH RECURSIVE family");
    await blocker.query("COMMIT"); expect((await pending).statusCode).toBe(401);
    await blocker.query("BEGIN"); await blocker.query("UPDATE users.tenant_members SET role='viewer' WHERE tenant_id=$1 AND user_id=$2", [demoted.tenantId, demoted.userId]);
    const roleWait = demoted.claim().then(response => response); await waitForLock("SELECT role FROM users.tenant_members");
    await blocker.query("COMMIT"); expect((await roleWait).statusCode).toBe(403);
    expect((await handle.pool.query("SELECT count(*)::int n FROM telemetry.device_provisionings WHERE build_id=ANY($1::uuid[])", [[revoked.buildId, demoted.buildId]])).rows[0].n).toBe(0);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
});
it("enforces immutable tenant/build/device linkage in PostgreSQL and does not silently change identity on claim retry", async () => {
  const a = await fixture(), b = await fixture(), claimed = await a.claim(), id = claimed.json().device_id;
  await expect(handle.pool.query("UPDATE builds.builds SET tenant_id=$2 WHERE id=$1", [a.buildId, b.tenantId])).rejects.toMatchObject({ code: "23503" });
  await expect(handle.pool.query("UPDATE telemetry.devices SET tenant_id=$2 WHERE id=$1", [id, b.tenantId])).rejects.toMatchObject({ code: "23503" });
  const before = (await handle.pool.query("SELECT token_hash,channels,source FROM telemetry.devices WHERE id=$1", [id])).rows[0];
  const retry = await a.post("/v1/devices/claim", { ...a.body, request_id: randomUUID() });
  expect(retry.json().device_id).toBe(id);
  expect((await handle.pool.query("SELECT token_hash,channels,source FROM telemetry.devices WHERE id=$1", [id])).rows[0]).toEqual(before);
  expect((await b.post("/v1/devices/claim", { ...b.body, build_id: a.buildId })).statusCode).toBe(404);
  expect((await app.inject({ url: `/v1/devices/${id}/provisioning`, headers: { cookie: b.cookie } })).statusCode).toBe(404);
});

it("executes the firmware's actual C serializer with issued configuration and ingests its bytes over HTTP", async () => {
  const directory = mkdtempSync(join(tmpdir(), "albus-wire-")), executable = join(directory, "encode");
  try {
    const firmware = fileURLToPath(new URL("../../../firmware/", import.meta.url));
    execFileSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", `-I${join(firmware, "esp32s3/main/include")}`, join(firmware, "tools/encode.c"), join(firmware, "esp32s3/main/hsx_wire.c"), "-o", executable]);
    const f = await fixture(), id = (await f.claim()).json().device_id;
    const config = DeviceConfigV1.parse((await f.post(`/v1/devices/${id}/configuration`, f.request())).json());
    const url = await ingest.listen({ host: "127.0.0.1", port: 0 });
    let packet = "";
    for (const [offset, value] of [[0, 0], [1, 65535]]) {
      packet = execFileSync(executable, [config.device_id, String(config.seq_start + offset!), String(Math.floor(Date.now() / 1000)), String(value), "10"], { encoding: "utf8" });
      expect(TelemetryEnvelope.parse(JSON.parse(packet)).r[0]!.v).toBe(value);
      const accepted = await fetch(`${url}/ingest/v1`, { method: "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: packet, signal: AbortSignal.timeout(3000) });
      expect(accepted.status).toBe(202);
    }
    expect((await handle.pool.query("SELECT value FROM telemetry.latest WHERE device_id=$1 AND channel='illuminance'", [id])).rows[0].value).toBe(65535);
    expect((await f.post(`/v1/devices/${id}/credential/revoke`, f.request())).statusCode).toBe(200);
    expect((await fetch(`${url}/ingest/v1`, { method: "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: packet, signal: AbortSignal.timeout(3000) })).status).toBe(401);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it("serializes a reused claim request across different builds and returns a controlled conflict", async () => {
  const f = await fixture(), second = await seedProvisioningFixture(handle.pool, f.tenantId, f.userId);
  const results = await Promise.all([f.claim(), f.post("/v1/devices/claim", { ...f.body, build_id: second.buildId })]);
  expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
  expect((await handle.pool.query("SELECT count(*)::int n FROM telemetry.device_provisionings WHERE tenant_id=$1", [f.tenantId])).rows[0].n).toBe(1);
});
