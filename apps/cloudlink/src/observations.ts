import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { ObservationAck, ObservationHeaders } from "@albusforge/schema";
import { StoragePreconditionError, type ObservationStorage, type StoredObject } from "@albusforge/storage";
import { bearerHash, tokenHash } from "./device-auth.js";
import { validateJpeg } from "./jpeg.js";
import { observationEvents } from "./observation-events.js";
import type { Log } from "./app.js";
import { IngestAdmission } from "./admission.js";

interface Metadata { deviceId: string; observationId: string; capabilityId: string; payloadSchema: "jpeg.v1"; capturedAt: number; sha256: string }
interface Capability { tenant_id: string; max_bytes: number; max_width: number; max_height: number }
interface Receipt {
  fingerprint: string; state: "reserved" | "stored" | "expired" | "failed"; lease_id: string | null; lease_until: Date | null;
  received_at: Date | null; expires_at: Date; sha256: string; bytes: string; reserved_day: string;
}
export interface ObservationOptions {
  store: ObservationStorage;
  maxInflight?: number;
  maxDailyCount?: number;
  maxDailyBytes?: number;
  maxAttemptsPerMinute?: number;
  leaseMs?: number;
}
class Rejected extends Error {
  constructor(readonly statusCode: number, readonly code: string) { super(code); }
}
async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    discard = !(error instanceof Rejected);
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}
async function authorize(client: PoolClient, metadata: Metadata, credentialHash: string): Promise<Capability> {
  // Same device lock as v1 ingestion and credential lifecycle; release before object I/O.
  const device = (await client.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM telemetry.devices WHERE id=$1 AND token_hash=$2 AND revoked_at IS NULL FOR NO KEY UPDATE",
    [metadata.deviceId, credentialHash],
  )).rows[0];
  if (!device) throw new Rejected(401, "unauthorized");
  const capability = (await client.query<Capability & { enabled: boolean; kind: string; payload_schema: string }>(
    "SELECT enabled,kind,payload_schema,max_bytes,max_width,max_height FROM telemetry.device_capabilities WHERE device_id=$1 AND capability_id=$2 FOR SHARE",
    [metadata.deviceId, metadata.capabilityId],
  )).rows[0];
  if (!capability?.enabled || capability.kind !== "image" || capability.payload_schema !== metadata.payloadSchema) throw new Rejected(403, "capability_forbidden");
  if (!Number.isInteger(capability.max_bytes) || !Number.isInteger(capability.max_width) || !Number.isInteger(capability.max_height)
    || capability.max_bytes < 1 || capability.max_bytes > 1048576 || capability.max_width < 1 || capability.max_width > 4096 || capability.max_height < 1 || capability.max_height > 4096) {
    throw new Rejected(503, "invalid_capability_configuration");
  }
  return { ...capability, tenant_id: device.tenant_id };
}
function ack(metadata: Metadata, receipt: Receipt) {
  return ObservationAck.parse({ observation_id: metadata.observationId, state: "stored", sha256: receipt.sha256, bytes: Number(receipt.bytes), received_at: receipt.received_at!.toISOString() });
}

/** Image codec behind the shared device identity. Numeric v1 retains its own SQL-only receipt. */
export function registerObservations(app: FastifyInstance, pool: Pool, options: ObservationOptions, now: () => Date = () => new Date(), admission = new IngestAdmission(8), log: Log = () => {}) {
  const events = observationEvents(app, log);
  const { store, maxInflight = 4, maxDailyCount = 1200, maxDailyBytes = 128 * 1024 * 1024, maxAttemptsPerMinute = 6, leaseMs = 30_000 } = options;
  const contexts = new WeakMap<FastifyRequest, { metadata: Metadata; credentialHash: string; capability: Capability; release: () => void; enter: () => void; leave: () => void; signal: AbortSignal }>();
  let inflight = 0;
  app.addContentTypeParser("image/jpeg", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof Rejected ? error.statusCode : (error as { statusCode?: number }).statusCode;
    const code = typeof status === "number" && status >= 400 && status < 500 ? status : 503;
    events.reject(request, error instanceof Rejected ? error.code : code < 500 ? "invalid_request" : "storage_unavailable");
    if (code === 503 || code === 429) reply.header("retry-after", code === 429 ? "60" : "1");
    return reply.code(code).send({ error: { code: error instanceof Rejected ? error.code : code < 500 ? "invalid_request" : "storage_unavailable", message: "Observation request rejected" } });
  });
  app.addHook("onResponse", async (request) => { contexts.get(request)?.release(); });
  app.post("/ingest/v2/devices/:deviceId/observations", {
    bodyLimit: 1048576,
    onRequest: async (request, reply) => {
      if (inflight >= maxInflight) throw new Rejected(503, "busy");
      const credentialHash = bearerHash(request.headers.authorization);
      if (!credentialHash) throw new Rejected(401, "unauthorized");
      const deviceId = z.uuid().safeParse((request.params as { deviceId: string }).deviceId);
      const headers = ObservationHeaders.safeParse({
        "x-observation-id": request.headers["x-observation-id"], "x-capability-id": request.headers["x-capability-id"],
        "x-payload-schema": request.headers["x-payload-schema"], "x-captured-at": request.headers["x-captured-at"], "x-content-sha256": request.headers["x-content-sha256"],
      });
      if (!deviceId.success || !headers.success) throw new Rejected(400, "invalid_metadata");
      const metadata: Metadata = { deviceId: deviceId.data, observationId: headers.data["x-observation-id"], capabilityId: headers.data["x-capability-id"],
        payloadSchema: headers.data["x-payload-schema"], capturedAt: headers.data["x-captured-at"], sha256: headers.data["x-content-sha256"] };
      if (request.headers["content-type"] !== "image/jpeg" || request.headers["content-encoding"] !== undefined) throw new Rejected(415, "unsupported_payload");
      const releaseShared = admission.acquire();
      if (!releaseShared) throw new Rejected(503, "busy");
      inflight++;
      let released = false;
      let working = true;
      let cleanupRequested = false;
      const controller = new AbortController();
      const release = () => { if (!released) { released = true; inflight--; releaseShared(); } };
      // Storage deadline stays below the lease. Disconnects cancel owned object I/O.
      const timer = setTimeout(() => { controller.abort(); request.raw.destroy(); }, Math.min(20_000, leaseMs));
      const cleanup = () => { clearTimeout(timer); controller.abort(); cleanupRequested = true; if (!working) release(); };
      const enter = () => { working = true; };
      const leave = () => { working = false; if (cleanupRequested) release(); };
      reply.raw.once("close", cleanup);
      try {
        const capability = await transaction(pool, async (client) => {
          const cap = await authorize(client, metadata, credentialHash);
          // Persist attempts across instances. Count even invalid JPEGs; numeric traffic is independent.
          const attempt = (await client.query<{ attempts: number }>(`INSERT INTO telemetry.observation_attempts(device_id,window_start,attempts)
            VALUES($1,date_trunc('minute',$2::timestamptz),1)
            ON CONFLICT(device_id) DO UPDATE SET
              attempts=CASE WHEN observation_attempts.window_start=date_trunc('minute',$2::timestamptz) THEN observation_attempts.attempts+1 ELSE 1 END,
              window_start=date_trunc('minute',$2::timestamptz) RETURNING attempts`, [metadata.deviceId, now()])).rows[0]!;
          // Commit rate accounting before rejecting; throwing here would roll it back.
          return { cap, limited: attempt.attempts > maxAttemptsPerMinute };
        });
        if (capability.limited) throw new Rejected(429, "attempt_limit");
        const length = request.headers["content-length"];
        if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > capability.cap.max_bytes)) throw new Rejected(413, "payload_too_large");
        contexts.set(request, { metadata, credentialHash, capability: capability.cap, release: cleanup, enter, leave, signal: controller.signal });
      } catch (error) { cleanup(); throw error; } finally { leave(); }
    },
  }, async (request, reply) => {
    const context = contexts.get(request)!;
    const { metadata, credentialHash, capability, signal } = context;
    context.enter();
    try {
      signal.throwIfAborted();
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new Rejected(422, "invalid_image");
      if (body.length > capability.max_bytes) throw new Rejected(413, "payload_too_large");
      const sha256 = createHash("sha256").update(body).digest("hex");
      if (sha256 !== metadata.sha256) throw new Rejected(422, "digest_mismatch");
      let dimensions: { width: number; height: number };
      try { dimensions = await validateJpeg(body, capability.max_width, capability.max_height); }
      catch { throw new Rejected(422, "invalid_image"); }
      signal.throwIfAborted();
      const fingerprint = tokenHash(JSON.stringify({ kind: "image", ...metadata, bytes: body.length, ...dimensions }));
      const lease = randomUUID();
      const admitted = now();
      const key = `tenant/${capability.tenant_id}/device/${metadata.deviceId}/${metadata.observationId}.jpg`;
      const reservation = await transaction(pool, async (client) => {
        const current = await authorize(client, metadata, credentialHash);
        signal.throwIfAborted();
        if (current.tenant_id !== capability.tenant_id) throw new Rejected(403, "ownership_changed");
        if (body.length > current.max_bytes || dimensions.width > current.max_width || dimensions.height > current.max_height) throw new Rejected(403, "capability_changed");
        const prior = (await client.query<Receipt>("SELECT * FROM telemetry.observation_receipts WHERE device_id=$1 AND observation_id=$2 FOR UPDATE", [metadata.deviceId, metadata.observationId])).rows[0];
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new Rejected(409, "observation_conflict");
          if (prior.state === "expired" || prior.expires_at <= admitted) throw new Rejected(410, "observation_expired");
          if (prior.state === "stored") return { prior };
          if (prior.lease_until && prior.lease_until > admitted) throw new Rejected(503, "observation_pending");
        }
        const captured = metadata.capturedAt * 1000;
        if (captured < admitted.getTime() - 7 * 86400_000 || captured > admitted.getTime() + 300_000) throw new Rejected(422, "timestamp_out_of_range");
        const day = admitted.toISOString().slice(0, 10);
        const used = (await client.query<{ count: string; bytes: string }>(`SELECT
          COALESCE((SELECT accepted_count FROM telemetry.observation_usage WHERE device_id=$1 AND day=$2),0)
            +(SELECT count(*) FROM telemetry.observation_receipts WHERE device_id=$1 AND reserved_day=$2 AND state='reserved' AND observation_id<>$3) AS count,
          COALESCE((SELECT accepted_bytes FROM telemetry.observation_usage WHERE device_id=$1 AND day=$2),0)
            +COALESCE((SELECT sum(bytes) FROM telemetry.observation_receipts WHERE device_id=$1 AND reserved_day=$2 AND state='reserved' AND observation_id<>$3),0) AS bytes`,
        [metadata.deviceId, day, metadata.observationId])).rows[0]!;
        if (Number(used.count) + 1 > maxDailyCount || Number(used.bytes) + body.length > maxDailyBytes) throw new Rejected(429, "daily_quota");
        if (!prior) {
          if ((await client.query("SELECT 1 FROM telemetry.observation_deletion_intents WHERE object_key=$1", [key])).rowCount) throw new Rejected(410, "observation_expired");
          await client.query(`INSERT INTO telemetry.observation_receipts
            (device_id,observation_id,capability_id,fingerprint,sha256,bytes,captured_at,expires_at,state,lease_id,lease_until,reserved_day,reservation_credential_hash)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,'reserved',$9,$10,$11,$12)`,
          [metadata.deviceId, metadata.observationId, metadata.capabilityId, fingerprint, sha256, body.length, new Date(captured), new Date(captured + 30 * 86400_000), lease, new Date(admitted.getTime() + leaseMs), day, credentialHash]);
          await client.query("INSERT INTO telemetry.observation_images(device_id,observation_id,object_key,width,height) VALUES($1,$2,$3,$4,$5)", [metadata.deviceId, metadata.observationId, key, dimensions.width, dimensions.height]);
        } else {
          await client.query("UPDATE telemetry.observation_receipts SET state='reserved',lease_id=$3,lease_until=$4,reserved_day=$5,reservation_credential_hash=$6 WHERE device_id=$1 AND observation_id=$2", [metadata.deviceId, metadata.observationId, lease, new Date(admitted.getTime() + leaseMs), day, credentialHash]);
        }
        return { prior: undefined };
      });
      if (reservation.prior) return reply.code(200).send(ack(metadata, reservation.prior));
      signal.throwIfAborted();
      let object: StoredObject;
      try { object = await events.storage(request, () => store.create(key, body, { sha256, fingerprint }, signal)); }
      catch (error) {
        if (!(error instanceof StoragePreconditionError)) throw error;
        const existing = await events.storage(request, () => store.head(key, signal));
        if (!existing) throw new Rejected(503, "object_unavailable");
        object = existing;
      }
      if (object.sha256 !== sha256 || object.fingerprint !== fingerprint || object.bytes !== body.length) throw new Rejected(409, "object_conflict");
      signal.throwIfAborted();
      const stored = await transaction(pool, async (client) => {
        const current = await authorize(client, metadata, credentialHash);
        signal.throwIfAborted();
        if (current.tenant_id !== capability.tenant_id) throw new Rejected(403, "ownership_changed");
        if (body.length > current.max_bytes || dimensions.width > current.max_width || dimensions.height > current.max_height) throw new Rejected(403, "capability_changed");
        const prior = (await client.query<Receipt>("SELECT * FROM telemetry.observation_receipts WHERE device_id=$1 AND observation_id=$2 FOR UPDATE", [metadata.deviceId, metadata.observationId])).rows[0];
        const received = now();
        if (!prior || prior.fingerprint !== fingerprint || prior.state !== "reserved" || prior.lease_id !== lease || !prior.lease_until || prior.lease_until <= received) throw new Rejected(503, "reservation_lost");
        // A request crossing midnight retries into the next day's quota reservation.
        if (prior.reserved_day !== received.toISOString().slice(0, 10)) throw new Rejected(503, "reservation_day_changed");
        await client.query("UPDATE telemetry.observation_images SET generation=$3 WHERE device_id=$1 AND observation_id=$2", [metadata.deviceId, metadata.observationId, object.generation]);
        const receipt = (await client.query<Receipt>(`UPDATE telemetry.observation_receipts SET state='stored',received_at=$3,lease_id=NULL,lease_until=NULL
          WHERE device_id=$1 AND observation_id=$2 RETURNING *`, [metadata.deviceId, metadata.observationId, received])).rows[0]!;
        await client.query(`INSERT INTO telemetry.observation_usage(device_id,day,accepted_count,accepted_bytes) VALUES($1,$2,1,$3)
          ON CONFLICT(device_id,day) DO UPDATE SET accepted_count=observation_usage.accepted_count+1,accepted_bytes=observation_usage.accepted_bytes+EXCLUDED.accepted_bytes`, [metadata.deviceId, prior.reserved_day, body.length]);
        await client.query(`INSERT INTO telemetry.capability_presence(device_id,capability_id,last_capture_at,last_received_at) VALUES($1,$2,$3,$4)
          ON CONFLICT(device_id,capability_id) DO UPDATE SET last_capture_at=GREATEST(capability_presence.last_capture_at,EXCLUDED.last_capture_at),
          last_received_at=GREATEST(capability_presence.last_received_at,EXCLUDED.last_received_at)`, [metadata.deviceId, metadata.capabilityId, new Date(metadata.capturedAt * 1000), received]);
        return receipt;
      });
      events.accept(request, body.length);
      return reply.code(201).send(ack(metadata, stored));
    } finally { context.leave(); context.release(); }
  });
}
