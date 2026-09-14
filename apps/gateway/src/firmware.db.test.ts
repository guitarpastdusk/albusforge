import { createTestDb as createDb, closeTestPool } from "./test-pool-shutdown";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { syntheticPlanFixture, syntheticCameraPlanFixture, syntheticCameraApproval } from "../../codegen/src/testing";
import { type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import {
  FirmwareManifest,
  FirmwarePage,
  SESSION_COOKIE,
  serializeFirmwareManifest,
} from "@albusforge/schema";
import { runOne } from "@albusforge/codegen/worker";
import { CAMERA_CANDIDATE, CAMERA_RUNTIME, CAMERA_CAPABILITIES, renderCameraApp } from "../../codegen/src/camera-candidate";
import type { CameraPlanApproval } from "@albusforge/codegen/accepted-candidate";
import { renderApp, CANDIDATE, CHANNELS } from "@albusforge/codegen/candidate";
import {
  sha256,
  type CompileInput,
  type Compiled,
} from "@albusforge/codegen/compiler";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { parseHandoffKeys } from "./device-credential";
import { ProvisioningProfile } from "./provisioning-profile";
import { loadProvisioningAuthority } from "./provisioning-authority";
let container: StartedPostgreSqlContainer,
  handle: ReturnType<typeof createDb>,
  app: FastifyInstance;
const objects = new Map<string, Buffer>();
const artifacts = {
  async put(key: string, bytes: Buffer) {
    if (objects.has(key)) throw new Error("Immutable object exists");
    objects.set(key, bytes);
  },
  async get(key: string) {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("Missing object");
    return bytes;
  },
};
const firmwareOptions = { enabled: true, artifacts, cameraApprovals: [] as CameraPlanApproval[] };
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").withTmpFs({ "/var/lib/postgresql/data": "rw,size=256m" }).start();
  const admin = new pg.Client({
    connectionString: container.getConnectionUri(),
  });
  await admin.connect();
  await admin.query(
    "CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate'",
  );
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();
  const config: DbConfig = {
    host: container.getHost(),
    port: container.getPort(),
    database: "albus",
    user: "albus_migrate",
    password: "migrate",
    ssl: "disable",
  };
  await runMigrations(config, {
    appRole: { name: "albus_app", password: "app" },
  });
  handle = createDb(
    { ...config, user: "albus_app", password: "app" },
    {
      max: 6,
      statementTimeoutMs: 2000,
      queryTimeoutMs: 3000,
      connectTimeoutMs: 1000,
    },
  );
  app = buildApp({
    parts: { latest: async () => [] },
    ping: async () => {},
    telemetryPool: handle.pool,
    firmware: firmwareOptions,
    log: () => {},
  });
});
beforeEach(async () => {
  await handle.pool.query("DELETE FROM builds.builds");
  objects.clear();
  firmwareOptions.cameraApprovals = [];
});
afterAll(async () => {
  await app?.close();
  await closeTestPool(handle?.pool);
  await container?.stop();
});
async function fixture(role = "operator", camera = false) {
  const tenant = randomUUID(),
    user = randomUUID(),
    build = randomUUID(),
    session = randomUUID(),
    token = randomBytes(32).toString("base64url");
  await handle.pool.query(
    "INSERT INTO users.tenants(id,name,slug) VALUES($1,'test',$2)",
    [tenant, `t-${tenant}`],
  );
  await handle.pool.query("INSERT INTO users.users(id,email) VALUES($1,$2)", [
    user,
    `${user}@example.test`,
  ]);
  await handle.pool.query(
    "INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,$3)",
    [tenant, user, role],
  );
  await handle.pool.query(
    "INSERT INTO users.sessions(id,token_hash,user_id,active_tenant_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
    [session, createHash("sha256").update(token).digest("hex"), user, tenant],
  );
  await handle.pool.query(
    "INSERT INTO builds.builds(id,tenant_id,ask_text) VALUES($1,$2,'synthetic firmware test')",
    [build, tenant],
  );
  const fixtureData = camera ? syntheticCameraPlanFixture() : syntheticPlanFixture();
  const { spec, parts, wiring, metadata } = fixtureData;
  const pin = (id: string) => ({ id, version: "1.0.0" });
  await handle.pool.query(
    "INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,1,$2,1)",
    [build, spec],
  );
  await handle.pool.query(
    "INSERT INTO builds.plans(build_id,version,spec_version,part_versions,wiring_graph,power_budget,bom,solver_log,metadata,accepted_at,accepted_by) VALUES($1,1,1,$2,$3,$4,$5,'[]',$6,now(),$7)",
    [
      build,
      JSON.stringify(parts.map((p) => pin(p.id))),
      wiring,
      {
        average_source_ma: 50,
        peak_source_ma: 400,
        peak_brain_rail_ma: 400,
        usable_capacity_mah: null,
        estimated_life_days: null,
      },
      JSON.stringify(
        parts.map((p) => ({ part: pin(p.id), quantity: 1, unit_cost_usd: 10 })),
      ),
      metadata,
      user,
    ],
  );
  const cookie = `${SESSION_COOKIE}=${token}`,
    root = `/v1/builds/${build}/code`,
    requestId = randomUUID();
  const post = (
    payload: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: "POST",
      url: root,
      headers: { cookie, origin: "http://localhost", ...headers },
      payload: {
        tenant_id: tenant,
        plan_version: 1,
        request_id: requestId,
        ...payload,
      },
    });
  const get = () =>
    app.inject({ method: "GET", url: root, headers: { cookie } });
  return {
    tenant,
    user,
    build,
    session,
    cookie,
    root,
    post,
    get,
    requestId,
    cameraApproval: camera ? syntheticCameraApproval(fixtureData as ReturnType<typeof syntheticCameraPlanFixture>) : null,
    spec,
    metadata,
  };
}
async function compiled(input: CompileInput): Promise<Compiled> {
  // Transaction/unit scheduling fixture. Real ESP-IDF compilation is separately exercised by the committed compiler harness.
  const files = new Map(
    ["bootloader.bin", "partition-table.bin", "albusforge.bin"].map((name) => [
      name,
      Buffer.from(`${name}-${input.interval_s}`),
    ]),
  );
  const manifest = FirmwareManifest.parse({
    v: 1,
    build_id: input.build_id,
    plan_version: input.plan_version,
    code_version: input.code_version,
    profile_id: CANDIDATE,
    runtime: "0.1.0",
    channels: CHANNELS,
    files: [...files].map(([path, bytes]) => ({
      path,
      size: bytes.length,
      sha256: sha256(bytes),
    })),
    flash: { chip: "esp32s3", config_offset: 36864, config_size: 24576 },
  });
  const manifestBytes = serializeFirmwareManifest(manifest),
    source = renderApp(input.interval_s);
  return {
    manifest,
    manifestBytes,
    manifest_digest: sha256(manifestBytes),
    source,
    source_sha256: sha256(source),
    files,
    bundle: Buffer.from("ZIP fixture"),
    diagnostics: "Synthetic compile fixture",
  };
}
it("requires current session, origin, tenant and operator role; hides foreign builds", async () => {
  const a = await fixture(),
    b = await fixture("viewer");
  expect((await a.post({}, { cookie: "" })).statusCode).toBe(401);
  expect((await a.post({}, { origin: "https://evil.test" })).statusCode).toBe(
    403,
  );
  expect((await a.post({ tenant_id: b.tenant })).statusCode).toBe(409);
  expect((await b.post()).statusCode).toBe(403);
  expect(
    (
      await app.inject({
        method: "GET",
        url: a.root,
        headers: { cookie: b.cookie },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: "POST",
        url: a.root,
        headers: { cookie: b.cookie, origin: "http://localhost" },
        payload: {
          tenant_id: b.tenant,
          plan_version: 1,
          request_id: randomUUID(),
        },
      })
    ).statusCode,
  ).toBe(403);
  await handle.pool.query(
    "UPDATE users.sessions SET revoked_at=now() WHERE id=$1",
    [a.session],
  );
  expect((await a.post()).statusCode).toBe(401);
  expect(
    (await handle.pool.query("SELECT * FROM builds.code_bundles")).rows,
  ).toHaveLength(0);
});
it("queues idempotently, publishes exact artifact identity, and allows viewer verified downloads", async () => {
  const f = await fixture();
  const requests = await Promise.all([f.post(), f.post()]);
  expect(requests.map((x) => x.statusCode)).toEqual([202, 202]);
  expect(requests.map((x) => x.json())).toEqual([
    { version: 1 },
    { version: 1 },
  ]);
  expect(
    await runOne({ pool: handle.pool, artifacts, compile: compiled }),
  ).toBe(true);
  const page = FirmwarePage.parse((await f.get()).json());
  expect(page.versions[0]).toMatchObject({
    status: "passed",
    current: true,
    interval_s: 60,
    attempts: 1,
    manifest: { build_id: f.build, code_version: 1 },
  });
  await handle.pool.query(
    "UPDATE users.tenant_members SET role='viewer' WHERE user_id=$1",
    [f.user],
  );
  const file = await app.inject({
    method: "GET",
    url: `${f.root}/1/files/manifest.json`,
    headers: { cookie: f.cookie },
  });
  expect(file.statusCode).toBe(200);
  expect(file.headers["cache-control"]).toBe("private, no-store");
  expect(file.json().build_id).toBe(f.build);
  const key = [...objects.keys()].find((key) => key.endsWith("manifest.json"))!;
  objects.set(key, Buffer.from("tampered"));
  expect(
    (
      await app.inject({
        method: "GET",
        url: `${f.root}/1/files/manifest.json`,
        headers: { cookie: f.cookie },
      })
    ).statusCode,
  ).toBe(503);
});
it("requires accepted current plan and explicit supported immutable evidence", async () => {
  const f = await fixture();
  await handle.pool.query(
    "UPDATE builds.plans SET accepted_at=NULL WHERE build_id=$1",
    [f.build],
  );
  expect((await f.post()).statusCode).toBe(409);
  await handle.pool.query(
    "UPDATE builds.plans SET accepted_at=now(),metadata=jsonb_set(metadata,'{evidence,parts,0,status}','\"draft\"') WHERE build_id=$1",
    [f.build],
  );
  expect((await f.post()).statusCode).toBe(422);
  await handle.pool.query(
    "UPDATE builds.plans SET metadata=$2 WHERE build_id=$1",
    [f.build, f.metadata],
  );
  await handle.pool.query(
    "INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,2,$2,1)",
    [f.build, f.spec],
  );
  expect((await f.post()).statusCode).toBe(409);
});
it("compiles bounded edits as new versions, preserves earlier output and refuses shortened power interval", async () => {
  const f = await fixture();
  await f.post();
  await runOne({ pool: handle.pool, artifacts, compile: compiled });
  expect(
    (
      await f.post({
        request_id: randomUUID(),
        based_on: 1,
        instruction: "Set interval to 30 seconds",
      })
    ).statusCode,
  ).toBe(422);
  expect(
    (
      await f.post({
        request_id: randomUUID(),
        based_on: 1,
        instruction: "#include <stdio.h>",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await f.post({
        request_id: randomUUID(),
        based_on: 1,
        instruction: "Set interval to 120 seconds",
      })
    ).json(),
  ).toEqual({ version: 2 });
  await runOne({ pool: handle.pool, artifacts, compile: compiled });
  const page = FirmwarePage.parse((await f.get()).json());
  expect(page.versions.map((v) => v.interval_s)).toEqual([120, 60]);
  expect(page.versions[0]?.previous_source).toBe(renderApp(60));
  expect(page.versions[0]?.source).toBe(renderApp(120));
});
it("retains compile failures and caps explicit retries at three attempts", async () => {
  const f = await fixture();
  await f.post();
  const fail = async () => {
    throw new Error("Compile failed: fixture syntax error");
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    await runOne({ pool: handle.pool, artifacts, compile: fail });
    const state = FirmwarePage.parse((await f.get()).json()).versions[0]!;
    expect(state.status).toBe("failed");
    expect(state.attempts).toBe(attempt);
    expect(state.diagnostics).toContain("fixture syntax error");
    const retry = await app.inject({
      method: "POST",
      url: `${f.root}/1/retry`,
      headers: { cookie: f.cookie, origin: "http://localhost" },
      payload: { tenant_id: f.tenant },
    });
    expect(retry.statusCode).toBe(attempt < 3 ? 202 : 409);
  }
  expect(objects.size).toBe(0);
});
it("refuses publication when a newer spec arrives during compilation", async () => {
  const f = await fixture();
  await f.post();
  await runOne({
    pool: handle.pool,
    artifacts,
    compile: async (input) => {
      await handle.pool.query(
        "INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,2,$2,1)",
        [f.build, f.spec],
      );
      return compiled(input);
    },
  });
  expect(FirmwarePage.parse((await f.get()).json()).versions[0]).toMatchObject({
    status: "failed",
    current: false,
    error: "Accepted plan is no longer current",
  });
  expect(
    (
      await app.inject({
        method: "GET",
        url: `${f.root}/1/files/firmware.zip`,
        headers: { cookie: f.cookie },
      })
    ).statusCode,
  ).toBe(404);
});
it("concurrent workers admit one active compiler and later claim each queued version once", async () => {
  const a = await fixture(),
    b = await fixture();
  await a.post();
  await b.post();
  const calls: string[] = [];
  await Promise.all(
    [1, 2, 3].map(() =>
      runOne({
        pool: handle.pool,
        artifacts,
        compile: async (input) => {
          calls.push(input.build_id);
          return compiled(input);
        },
      }),
    ),
  );
  expect(calls).toHaveLength(1);
  await runOne({pool:handle.pool,artifacts,compile:async(input)=>{calls.push(input.build_id);return compiled(input);}});
  expect(calls.sort()).toEqual([a.build, b.build].sort());
  expect(new Set(calls).size).toBe(2);
});

it.skipIf(process.env.FIRMWARE_REAL_COMPILER !== "1")(
  "compiles an accepted fixture through the real isolated worker and downloads its verified ZIP",
  async () => {
    const { compile } = await import("@albusforge/codegen/compiler");
    const results: Compiled[] = [];
    const f = await fixture();
    expect((await f.post()).statusCode).toBe(202);
    await runOne({
      pool: handle.pool,
      artifacts,
      compile: async (input) => {
        const template = new URL("../../../firmware/esp32s3", import.meta.url)
          .pathname;
        const first = await compile(input, template);
        results.push(first);
        if (process.env.FIRMWARE_REPRO_CHECK === "1") {
          const second = await compile(input, template);
          results.push(second);
        }
        return first;
      },
    });
    const page = FirmwarePage.parse((await f.get()).json());
    expect(page.versions[0]?.status, JSON.stringify(page.versions[0])).toBe(
      "passed",
    );
    if (process.env.FIRMWARE_REPRO_CHECK === "1") {
      expect(results).toHaveLength(2);
      expect(results[1]!.manifestBytes).toEqual(results[0]!.manifestBytes);
      expect(sha256(results[1]!.bundle)).toEqual(sha256(results[0]!.bundle));
    }
    const zip = await app.inject({
      method: "GET",
      url: `${f.root}/1/files/firmware.zip`,
      headers: { cookie: f.cookie },
    });
    expect(zip.statusCode).toBe(200);
    expect(zip.rawPayload.length).toBeGreaterThan(100000);
    expect(
      page.versions[0]?.manifest?.files.find(
        (file) => file.path === "albusforge.bin",
      )?.size,
    ).toBeGreaterThan(500000);
  },
  900000,
);

it("checks accepted spec after a blocked publication obtains the build lock", async () => {
  const f = await fixture();
  await f.post();
  const blocker = await handle.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM builds.builds WHERE id=$1 FOR UPDATE", [
    f.build,
  ]);
  const pending = runOne({ pool: handle.pool, artifacts, compile: compiled });
  try {
    const until = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < until) {
      waiting =
        (
          await handle.pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE usename=current_user AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM builds.builds WHERE id=%'",
          )
        ).rowCount! > 0;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await blocker.query(
      "INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,2,$2,1)",
      [f.build, f.spec],
    );
    await blocker.query("COMMIT");
    await pending;
    expect(
      FirmwarePage.parse((await f.get()).json()).versions[0],
    ).toMatchObject({
      status: "failed",
      current: false,
      error: "Accepted plan is no longer current",
    });
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await pending;
  }
});

it("fences a superseded row lease and recovers it after admission becomes available", async () => {
  const f = await fixture();
  await f.post();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    claimed = new Promise<void>((resolve) => {
      entered = resolve;
    });
  const original = runOne({
    pool: handle.pool,
    artifacts,
    compile: async (input) => {
      entered();
      await held;
      return compiled(input);
    },
  });
  await claimed;
  try {
    await handle.pool.query(
      "UPDATE builds.code_bundles SET updated_at=now()-interval '16 minutes',compile_log=jsonb_set(compile_log,'{lease}',to_jsonb($2::text)) WHERE build_id=$1",
      [f.build, randomUUID()],
    );
    expect(await runOne({ pool: handle.pool, artifacts, compile: compiled })).toBe(false);
    release();
    await original;
    expect((await handle.pool.query("SELECT status FROM builds.code_bundles WHERE build_id=$1",[f.build])).rows[0].status).toBe("running");
    await runOne({ pool: handle.pool, artifacts, compile: compiled });
    expect(
      FirmwarePage.parse((await f.get()).json()).versions[0],
    ).toMatchObject({ status: "passed", attempts: 2 });
  } finally {
    release();
    await original;
  }
});


it.each([60, 120, 30])("provisions compiled cadence %i against an accepted 60-second plan", async (interval) => {
  const f = await fixture();
  expect((await f.post()).statusCode).toBe(202);
  await runOne({ pool: handle.pool, artifacts, compile: compiled });
  let codeVersion = 1;
  if (interval === 120) {
    expect((await f.post({ request_id: randomUUID(), based_on: 1, instruction: "Set interval to 120 seconds" })).statusCode).toBe(202);
    await runOne({ pool: handle.pool, artifacts, compile: compiled });
    codeVersion = 2;
  } else if (interval === 30) {
    // The producer refuses shorter edits; also exercise provisioning's independent
    // refusal of a malformed passed record instead of trusting producer admission.
    expect((await f.post({ request_id: randomUUID(), based_on: 1, instruction: "Set interval to 30 seconds" })).statusCode).toBe(422);
    await handle.pool.query("UPDATE builds.code_bundles SET compile_log=jsonb_set(compile_log,'{job,interval_s}','30') WHERE build_id=$1 AND version=1", [f.build]);
  }
  const profile = ProvisioningProfile.parse({
    id: "synthetic-firmware-provisioning", version: "1.0.0", assembly_profile: f.metadata.profile,
    runtime: "0.1.0", part_versions: f.metadata.evidence.parts.map(part => ({ id: part.id, version: part.version })),
    firmware_profile_id: CANDIDATE,
    health_sources: [{ part: { id: "C-001", version: "1.0.0" }, telemetry_schema: "device_health.v1" }],
    channels: [{ key: "illuminance", range: CHANNELS.illuminance, part: { id: "V-005", version: "1.0.0" },
      telemetry_schema: f.metadata.evidence.parts.find(part => part.id === "V-005")!.cloud.telemetry_schema }],
  });
  const client = await handle.pool.connect();
  try {
    await client.query("BEGIN");
    const authority = loadProvisioningAuthority(client, f.tenant, f.build, 1, codeVersion, [profile]);
    if (interval < 60) await expect(authority).rejects.toMatchObject({ statusCode: 409, code: "FIRMWARE_NOT_READY" });
    else expect((await authority).nextS).toBe(interval);
  } finally { await client.query("ROLLBACK"); client.release(); }
  const provisioning = buildApp({ parts: { latest: async () => [] }, ping: async () => {}, telemetryPool: handle.pool,
    deviceProvisioning: { profiles: [profile], ingestUrl: "https://ingest.example.test/ingest/v1",
      keys: parseHandoffKeys(JSON.stringify({ active: "test", keys: { test: randomBytes(32).toString("base64url") } })) }, log: () => {} });
  try {
    const response = await provisioning.inject({ method: "POST", url: "/v1/devices/claim",
      headers: { cookie: f.cookie, origin: "http://localhost" },
      payload: { expected_tenant_id: f.tenant, build_id: f.build, plan_version: 1, code_version: codeVersion, request_id: randomUUID() } });
    const devices = (await handle.pool.query("SELECT id,next_s FROM telemetry.devices WHERE tenant_id=$1", [f.tenant])).rows;
    if (interval < 60) {
      expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("FIRMWARE_NOT_READY"); expect(devices).toHaveLength(0);
    } else {
      expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ build_id: f.build, plan_version: 1, code_version: codeVersion });
      expect(devices).toEqual([{ id: response.json().device_id, next_s: interval }]);
    }
  } finally {
    await provisioning.close();
    await handle.pool.query("DELETE FROM telemetry.devices WHERE tenant_id=$1", [f.tenant]);
  }
});

async function cameraCompiled(input:CompileInput):Promise<Compiled> {
  const result=await compiled(input);
  result.manifest=FirmwareManifest.parse({...result.manifest,profile_id:CAMERA_CANDIDATE,runtime:CAMERA_RUNTIME,channels:{},capabilities:CAMERA_CAPABILITIES});
  result.manifestBytes=serializeFirmwareManifest(result.manifest);result.manifest_digest=sha256(result.manifestBytes);
  result.source=renderCameraApp(input.interval_s);result.source_sha256=sha256(result.source);
  return result;
}
it("keeps camera plans gated, dispatches approved native candidates and renders current/previous source with fixed cadence",async()=>{
  const f=await fixture("operator",true);
  expect((await f.post()).statusCode).toBe(422);
  firmwareOptions.cameraApprovals=[f.cameraApproval!];
  expect((await f.post()).statusCode).toBe(202);
  await runOne({pool:handle.pool,artifacts,cameraApprovals:firmwareOptions.cameraApprovals,compile:async()=>{throw Error('wrong numeric compiler');},compileCamera:cameraCompiled});
  const page=FirmwarePage.parse((await f.get()).json());
  expect(page.versions[0]).toMatchObject({status:'passed',interval_s:900,source:renderCameraApp(900),manifest:{profile_id:CAMERA_CANDIDATE,channels:{},capabilities:CAMERA_CAPABILITIES}});
  expect((await f.post({request_id:randomUUID(),based_on:1,instruction:'Set interval to 1800 seconds'})).statusCode).toBe(400);
  expect((await f.post({request_id:randomUUID(),based_on:1,instruction:'Set interval to 900 seconds'})).statusCode).toBe(202);
  expect(FirmwarePage.parse((await f.get()).json()).versions[0]?.previous_source).toBe(renderCameraApp(900));
});
it.each(['interval','approval','manifest','capabilities','source','files','publication'] as const)("rejects camera %s tampering before publishing artifacts",async(kind)=>{
  const f=await fixture("operator",true);firmwareOptions.cameraApprovals=[f.cameraApproval!];
  expect((await f.post()).statusCode).toBe(202);
  if(kind==='interval')await handle.pool.query("UPDATE builds.code_bundles SET compile_log=jsonb_set(compile_log,'{job,interval_s}','1800') WHERE build_id=$1",[f.build]);
  await runOne({pool:handle.pool,artifacts,cameraApprovals:kind==='approval'?[]:firmwareOptions.cameraApprovals,compile:compiled,compileCamera:async(input)=>{
    const result=await cameraCompiled(input);
    if(kind==='manifest')result.manifest.runtime='0.1.0';
    if(kind==='capabilities')result.manifest.capabilities![0]!.interval_s=1800;
    if(kind==='source')result.source=renderApp(900);
    if(kind==='files')result.files.set('albusforge.bin',Buffer.from('changed'));
    if(kind==='publication')await handle.pool.query("UPDATE builds.plans SET accepted_at=NULL WHERE build_id=$1",[f.build]);
    return result;
  }});
  const row=(await handle.pool.query('SELECT status,storage_ref FROM builds.code_bundles WHERE build_id=$1',[f.build])).rows[0];
  expect(row.status).toBe('failed');expect(row.storage_ref).toBeNull();
});

it("losing the dedicated advisory session aborts compilation and prevents publication",async()=>{
  const f=await fixture();await f.post();let cancelled=false;
  await runOne({pool:handle.pool,artifacts,compile:async(input,signal)=>{
    const owner=(await handle.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=284713 AND objid=1 AND granted")).rows[0]?.pid;
    expect(owner).toBeTypeOf('number');
    // Same restricted role can terminate its own backend; no owner role needed.
    await handle.pool.query('SELECT pg_terminate_backend($1)',[owner]);
    await new Promise<void>(resolve=>{if(signal?.aborted)resolve();else signal?.addEventListener('abort',()=>resolve(),{once:true});});
    cancelled=signal?.aborted===true;
    return compiled(input);
  }});
  expect(cancelled).toBe(true);
  const row=(await handle.pool.query('SELECT status,storage_ref FROM builds.code_bundles WHERE build_id=$1',[f.build])).rows[0];
  expect(row.status).toBe('failed');expect(row.storage_ref).toBeNull();expect(objects.size).toBe(0);
});

it("destroys an uncertain publication transaction before writing failure state on another connection",async()=>{
  const f=await fixture();await f.post();
  const owner=await handle.pool.connect();
  const pid=(await owner.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const ordinary=owner.query.bind(owner);
  owner.query=((...args:unknown[])=>{
    if(args[0]==='COMMIT')return Promise.reject(Error('simulated transport uncertainty before commit'));
    return Reflect.apply(ordinary,owner,args);
  }) as typeof owner.query;
  const runnerPool={connect:async()=>owner,query:handle.pool.query.bind(handle.pool)} as unknown as pg.Pool;
  const outcomes:string[]=[];
  await runOne({pool:runnerPool,artifacts,compile:compiled,observe:outcome=>outcomes.push(outcome)});
  expect(outcomes).toEqual(['failed']);
  expect((await handle.pool.query('SELECT status FROM builds.code_bundles WHERE build_id=$1',[f.build])).rows[0].status).toBe('failed');
  expect((await handle.pool.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0].n).toBe(0);
});
