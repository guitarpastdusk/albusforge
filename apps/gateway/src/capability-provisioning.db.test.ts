import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { DeviceConfigV2, serializeFirmwareManifest, type SensorCapability } from "@albusforge/schema";
import { MemoryObservationStorage } from "@albusforge/storage/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "./app";
import { buildApp as buildIngest } from "../../cloudlink/src/app";
import { parseHandoffKeys } from "./device-credential";
import { ProvisioningProfile } from "./provisioning-profile";
import { provisioningUser, seedProvisioningFixture } from "./provisioning.test-fixtures";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
const services: Array<ReturnType<typeof buildApp>> = [];
const keys = parseHandoffKeys(JSON.stringify({ active: "test", keys: { test: randomBytes(32).toString("base64url") } }))!;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").withTmpFs({ "/var/lib/postgresql/data": "rw,size=256m" }).start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() }); await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'local-migrate'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate"); await admin.end();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "local-migrate", ssl: "disable" };
  await runMigrations(config, { appRole: { name: "albus_app", password: "local-app" } });
  handle = createDb({ ...config, user: "albus_app", password: "local-app" }, { max: 8, connectTimeoutMs: 1000, statementTimeoutMs: 4000, queryTimeoutMs: 5000 });
});
afterAll(async () => { await Promise.all(services.map(app => app.close())); await handle?.pool.end(); await container?.stop(); });

/** Deliberately synthetic accepted evidence: server approves a test image codec
 * for the fixture source. It provides no real camera driver/hardware acceptance. */
async function fixture({ mixed = false, interval = 900, missingSource = false, manifestMismatch = false, optionalMeasurement = false } = {}) {
  const user = await provisioningUser(handle.pool);
  const seeded = await seedProvisioningFixture(handle.pool, user.tenantId, user.userId);
  const camera: SensorCapability = { id: "camera.front", kind: "image", schema: "jpeg.v1", profile_id: "synthetic-camera", profile_version: 1,
    enabled: true, required: true, interval_s: interval, max_bytes: 1048576, max_width: 320, max_height: 240 };
  const channel = seeded.profile.channels[0]!;
  const capabilities: SensorCapability[] = [camera];
  if (mixed) capabilities.push({ id: "light", kind: "measurement", schema: "readings.v1", profile_id: "synthetic-light", profile_version: 1,
    enabled: true, required: !optionalMeasurement, interval_s: 60, channels: { [channel.key]: channel.range } });
  const profile = ProvisioningProfile.parse({ ...seeded.profile, id: `synthetic-capabilities-${randomUUID()}`,
    channels: mixed ? seeded.profile.channels : [], capabilities,
    capability_sources: capabilities.map(cap => ({ capability_id: cap.id, part: missingSource ? { id: "missing", version: "1.0.0" } : channel.part,
      telemetry_schema: channel.telemetry_schema })) });
  seeded.firmware.manifest.channels = mixed ? { [channel.key]: channel.range } : {};
  seeded.firmware.manifest.capabilities = structuredClone(capabilities);
  if (manifestMismatch) seeded.firmware.manifest.capabilities[0]!.interval_s += 1;
  seeded.firmware.manifest_digest = digest(serializeFirmwareManifest(seeded.firmware.manifest));
  await handle.pool.query("UPDATE builds.code_bundles SET compile_log=$2 WHERE build_id=$1", [seeded.buildId, seeded.firmware]);
  const store = new MemoryObservationStorage();
  const app = buildApp({ parts: { latest: async () => [] }, ping: async () => {}, telemetryPool: handle.pool, observationStorage: store,
    deviceProvisioning: { keys, ingestUrl: "https://ingest.example.test/ingest/v1", profiles: [profile] }, log: () => {} });
  services.push(app);
  const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload, headers: { cookie: user.cookie, origin: "http://localhost" } });
  const claim = () => post("/v1/devices/claim", { build_id: seeded.buildId, plan_version: 1, code_version: 1, request_id: randomUUID(), expected_tenant_id: user.tenantId });
  const request = (version = 1) => ({ expected_version: version, expected_tenant_id: user.tenantId });
  const config = async (id: string, version = 1) => DeviceConfigV2.parse((await post(`/v1/devices/${id}/configuration`, request(version))).json());
  const setup = async (id: string) => (await app.inject({ url: `/v1/devices/${id}/setup`, headers: { cookie: user.cookie } })).json();
  const image = async (id: string) => {
    const observation = randomUUID(), bytes = Buffer.from("synthetic already validated image");
    const key = `tenant/${user.tenantId}/device/${id}/${observation}.jpg`;
    const object = await store.create(key, bytes, { sha256: digest(bytes), fingerprint: "a".repeat(64) });
    await handle.pool.query(`INSERT INTO telemetry.observation_receipts(device_id,observation_id,capability_id,fingerprint,sha256,bytes,captured_at,received_at,expires_at,state,reserved_day)
      VALUES($1,$2,'camera.front',$3,$4,$5,now(),now(),now()+interval '30 days','stored',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'))`, [id, observation, "a".repeat(64), digest(bytes), bytes.length]);
    await handle.pool.query("INSERT INTO telemetry.observation_images(device_id,observation_id,object_key,generation,width,height) VALUES($1,$2,$3,$4,320,240)", [id, observation, key, object.generation]);
    await handle.pool.query("INSERT INTO telemetry.capability_presence(device_id,capability_id,last_capture_at,last_received_at) VALUES($1,'camera.front',now(),now())", [id]);
    return observation;
  };
  return { ...user, app, store, post, claim, request, config, setup, image };
}
it("issues a one-time private camera-only v2 configuration pinned to its manifest and source", async () => {
  const f = await fixture();
  const claimed = await f.claim(); expect(claimed.statusCode).toBe(200);
  const id = claimed.json().device_id;
  const delivered = await f.post(`/v1/devices/${id}/configuration`, f.request());
  expect(delivered.statusCode).toBe(200);
  expect(delivered.headers["cache-control"]).toBe("private, no-store");
  const config = DeviceConfigV2.parse(delivered.json());
  expect(config.channels).toEqual({});
  expect(config.capabilities).toMatchObject([{ id: "camera.front", interval_s: 900 }]);
  expect(config.observation_url).toBe(`https://ingest.example.test/ingest/v2/devices/${id}/observations`);
  expect((await f.post(`/v1/devices/${id}/configuration`, f.request())).statusCode).toBe(410);
  expect((await f.setup(id)).state).toBe("waiting_for_upload");
  await f.image(id);
  expect((await f.setup(id)).state).toBe("confirmed");
  expect((await handle.pool.query("SELECT token_hash FROM telemetry.devices WHERE id=$1", [id])).rows[0].token_hash).toBe(digest(config.token));
});
it("requires independent numeric and camera receipts before confirming a mixed source", async () => {
  const f = await fixture({ mixed: true });
  const claimed = await f.claim(); expect(claimed.statusCode).toBe(200);
  const id = claimed.json().device_id, config = await f.config(id);
  const ingest = buildIngest({ pool: handle.pool, log: () => {} }); services.push(ingest);
  const ts = Math.floor(Date.now() / 1000);
  expect((await ingest.inject({ method: "POST", url: "/ingest/v1", headers: { authorization: `Bearer ${config.token}` },
    payload: { v: 1, dev: id, seq: 1, ts, r: [{ c: "illuminance", t: ts, v: 42 }], st: { up_s: 10, health: [] } } })).statusCode).toBe(202);
  const partial = await f.setup(id);
  expect(partial.state).toBe("waiting_for_capabilities");
  expect(partial.capabilities.find((c: { id: string }) => c.id === "light").status).toBe("healthy");
  await f.image(id);
  expect((await f.setup(id)).state).toBe("confirmed");
});
it.each([{ missingSource: true }, { manifestMismatch: true }, { interval: 30 }])("rejects unsupported source, changed manifest or faster-than-accepted cadence: %j", async options => {
  const f = await fixture(options);
  expect((await f.claim()).statusCode).toBe(409);
});
it("rotation and revocation change upload authority while preserving tenant image history", async () => {
  const f = await fixture();
  const id = (await f.claim()).json().device_id;
  const first = await f.config(id);
  await f.image(id);
  const replaced = await f.post(`/v1/devices/${id}/configuration/replace`, { ...f.request(), request_id: randomUUID() });
  expect(replaced.statusCode).toBe(200);
  const next = await f.config(id, 2); expect(next.token).not.toBe(first.token);
  expect((await handle.pool.query("SELECT token_hash FROM telemetry.devices WHERE id=$1", [id])).rows[0].token_hash).toBe(digest(next.token));
  expect((await f.post(`/v1/devices/${id}/credential/revoke`, f.request(2))).statusCode).toBe(200);
  expect((await f.setup(id)).state).toBe("credential_revoked");
  const latest = await f.app.inject({ url: `/v1/devices/${id}/capabilities/camera.front/images/latest`, headers: { cookie: f.cookie } });
  expect(latest.statusCode).toBe(200); expect(latest.json().image).not.toBeNull();
});

it("keeps a healthy 15-minute camera online between uploads instead of applying the numeric clock", async () => {
  const f = await fixture();
  const id = (await f.claim()).json().device_id;
  await f.image(id);
  await handle.pool.query("UPDATE telemetry.capability_presence SET last_capture_at=now()-interval '5 minutes',last_received_at=now()-interval '5 minutes' WHERE device_id=$1", [id]);
  const read = () => f.app.inject({ url: `/v1/telemetry/devices/${id}`, headers: { cookie: f.cookie } });
  expect((await read()).json().device.status).toBe("online");
  expect((await read()).json().capabilities[0].status).toBe("healthy");
  await handle.pool.query("UPDATE telemetry.capability_presence SET last_capture_at=now()-interval '1 hour',last_received_at=now()-interval '1 hour' WHERE device_id=$1", [id]);
  expect((await read()).json().device.status).toBe("offline");
});
it("optional numeric channels do not block a camera's setup confirmation or fleet health", async () => {
  const f = await fixture({ mixed: true, optionalMeasurement: true });
  const claimed = await f.claim(); expect(claimed.statusCode).toBe(200);
  const id = claimed.json().device_id;
  await f.image(id);
  const setup = await f.setup(id);
  expect(setup.state).toBe("confirmed");
  expect(setup.channels).toMatchObject([{ key: "illuminance", latest: null }]);
  expect((await f.app.inject({ url: `/v1/telemetry/devices/${id}`, headers: { cookie: f.cookie } })).json().device.status).toBe("online");
});
it("reports a disabled required camera as degraded even before its first receipt", async () => {
  const f = await fixture();
  const id = (await f.claim()).json().device_id;
  await handle.pool.query("UPDATE telemetry.device_capabilities SET enabled=false WHERE device_id=$1", [id]);
  const setup = await f.setup(id);
  expect(setup.state).toBe("degraded");
  expect(setup.capabilities[0].status).toBe("disabled");
});
it("blocks disabled numeric capabilities without accepting their data or acknowledging historical replays", async () => {
  const f = await fixture({ mixed: true });
  const id = (await f.claim()).json().device_id, config = await f.config(id);
  const ingest = buildIngest({ pool: handle.pool, log: () => {} }); services.push(ingest);
  const ts = Math.floor(Date.now() / 1000);
  const payload = { v: 1, dev: id, seq: 1, ts, r: [{ c: "illuminance", t: ts, v: 42 }], st: { up_s: 1, health: [] } };
  const send = (seq: number) => ingest.inject({ method: "POST", url: "/ingest/v1", headers: { authorization: `Bearer ${config.token}` }, payload: { ...payload, seq } });
  expect((await send(1)).statusCode).toBe(202);
  await handle.pool.query("UPDATE telemetry.device_capabilities SET enabled=false WHERE device_id=$1 AND capability_id='light'", [id]);
  expect((await send(1)).statusCode).toBe(403);
  expect((await send(2)).statusCode).toBe(403);
  expect((await handle.pool.query("SELECT count(*)::int AS n FROM telemetry.packets WHERE device_id=$1", [id])).rows).toEqual([{ n: 1 }]);
  await handle.pool.query("UPDATE telemetry.device_capabilities SET enabled=true WHERE device_id=$1 AND capability_id='light'", [id]);
  expect((await send(2)).statusCode).toBe(202);
});
