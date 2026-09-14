import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ObservationStorage } from "@albusforge/storage";

import { observationHealth, type ObservationHealth } from "./health.js";

const DAY = 86_400_000;
const WORKER_LOCK = "7243004119431865610";
interface Receipt {
  device_id: string; observation_id: string; capability_id: string; fingerprint: string; sha256: string; bytes: number;
  captured_at: Date; expires_at: Date; state: string; lease_id: string | null; lease_until: Date | null;
  reserved_day: string; reservation_credential_hash: string | null;
  object_key: string; width: number; height: number;
}
interface Device { token_hash: string; tenant_id: string; revoked_at: Date | null }
interface Capability { enabled: boolean; kind: string; payload_schema: string; max_bytes: number; max_width: number; max_height: number }
const UUID_SEGMENT = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const OBJECT_KEY = new RegExp(`^tenant/(${UUID_SEGMENT})/device/(${UUID_SEGMENT})/(${UUID_SEGMENT})\\.jpg$`);
function objectIdentity(key: string) {
  const parts = OBJECT_KEY.exec(key);
  return parts ? { tenant: parts[1]!.toLowerCase(), device: parts[2]!.toLowerCase(), observation: parts[3]!.toLowerCase() } : null;
}
export interface MaintenanceOptions {
  limit?: number;
  orphanGraceMs?: number;
  maxDailyCount?: number;
  maxDailyBytes?: number;
  now?: () => Date;
  signal?: AbortSignal;
  onAccepted?: (bytes: number) => void;
}
export interface MaintenanceResult { health?: ObservationHealth; busy: boolean; finalized: number; expired: number; deleted: number; orphans: number; deferred: number; errors: number }
async function transaction<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try { const result = await fn(); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}
async function lockDevice(client: PoolClient, id: string): Promise<Device | undefined> {
  return (await client.query<Device>("SELECT token_hash,tenant_id,revoked_at FROM telemetry.devices WHERE id=$1 FOR NO KEY UPDATE", [id])).rows[0];
}
async function receipt(client: PoolClient, device: string, observation: string): Promise<Receipt | undefined> {
  return (await client.query<Receipt>(`SELECT r.*,i.object_key,i.width,i.height FROM telemetry.observation_receipts r
    JOIN telemetry.observation_images i USING(device_id,observation_id)
    WHERE r.device_id=$1 AND r.observation_id=$2 FOR UPDATE OF r`, [device, observation])).rows[0];
}
async function allowed(client: PoolClient, device: Device | undefined, r: Receipt): Promise<boolean> {
  if (!device || device.revoked_at || !r.reservation_credential_hash || device.token_hash !== r.reservation_credential_hash) return false;
  const object = objectIdentity(r.object_key);
  if (!object || object.tenant !== device.tenant_id || object.device !== r.device_id || object.observation !== r.observation_id) return false;
  const cap = (await client.query<Capability>(`SELECT enabled,kind,payload_schema,max_bytes,max_width,max_height
    FROM telemetry.device_capabilities WHERE device_id=$1 AND capability_id=$2 FOR SHARE`, [r.device_id, r.capability_id])).rows[0];
  return !!cap?.enabled && cap.kind === "image" && cap.payload_schema === "jpeg.v1"
    && r.bytes <= cap.max_bytes && r.width <= cap.max_width && r.height <= cap.max_height;
}
async function expire(client: PoolClient, r: Receipt) {
  await client.query("UPDATE telemetry.observation_receipts SET state='expired',lease_id=NULL,lease_until=NULL WHERE device_id=$1 AND observation_id=$2", [r.device_id, r.observation_id]);
  // The database trigger persists deletion work outside tenant/device cascades.
  await client.query("DELETE FROM telemetry.observation_images WHERE device_id=$1 AND observation_id=$2", [r.device_id, r.observation_id]);
}
async function quota(client: PoolClient, r: Receipt, day: string, count: number, bytes: number) {
  const used = (await client.query<{ count: string; bytes: string }>(`SELECT
    COALESCE((SELECT accepted_count FROM telemetry.observation_usage WHERE device_id=$1 AND day=$2),0)
      +(SELECT count(*) FROM telemetry.observation_receipts WHERE device_id=$1 AND reserved_day=$2 AND state='reserved' AND observation_id<>$3) AS count,
    COALESCE((SELECT accepted_bytes FROM telemetry.observation_usage WHERE device_id=$1 AND day=$2),0)
      +COALESCE((SELECT sum(bytes) FROM telemetry.observation_receipts WHERE device_id=$1 AND reserved_day=$2 AND state='reserved' AND observation_id<>$3),0) AS bytes`,
  [r.device_id, day, r.observation_id])).rows[0]!;
  return Number(used.count) + 1 <= count && Number(used.bytes) + r.bytes <= bytes;
}

/** One bounded sweep, using only the restricted runtime role. SQL transactions
 * never span object I/O; a session advisory lock serializes cursor advancement.
 * HTTP writers still run concurrently and fence this worker with receipt leases.
 */
export async function maintainObservations(pool: Pool, store: ObservationStorage, options: MaintenanceOptions = {}): Promise<MaintenanceResult> {
  const { limit = 100, orphanGraceMs = 120_000, maxDailyCount = 1200, maxDailyBytes = 128 * 1024 * 1024,
    now = () => new Date(), signal = AbortSignal.timeout(240_000) } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid maintenance limit");
  if (!Number.isSafeInteger(orphanGraceMs) || orphanGraceMs < 120_000) throw new Error("Invalid orphan grace");
  if (!Number.isSafeInteger(maxDailyCount) || maxDailyCount < 1 || maxDailyCount > 10_000) throw new Error("Invalid daily observation limit");
  if (!Number.isSafeInteger(maxDailyBytes) || maxDailyBytes < 1 || maxDailyBytes > 1_073_741_824) throw new Error("Invalid daily byte limit");
  const result: MaintenanceResult = { busy: false, finalized: 0, expired: 0, deleted: 0, orphans: 0, deferred: 0, errors: 0 };
  const client = await pool.connect();
  let locked = false;
  let discard = false;
  try {
    locked = (await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [WORKER_LOCK])).rows[0]!.locked;
    if (!locked) { result.busy = true; return result; }
    const candidates = (await client.query<{ device_id: string; observation_id: string }>(`SELECT device_id,observation_id FROM telemetry.observation_receipts
      WHERE (state='stored' AND expires_at<=$1) OR (state='reserved' AND lease_until<=$1) OR state='failed'
      ORDER BY maintenance_checked_at NULLS FIRST,CASE WHEN state='stored' THEN expires_at ELSE lease_until END,device_id,observation_id LIMIT $2`, [now(), limit])).rows;
    for (const candidate of candidates) {
      signal.throwIfAborted();
      let storagePhase = false;
      try {
        const leaseId = randomUUID();
        const claim = await transaction(client, async () => {
          const device = await lockDevice(client, candidate.device_id);
          const r = await receipt(client, candidate.device_id, candidate.observation_id);
          if (!r || r.state === "expired") return undefined;
          const time = now();
          await client.query("UPDATE telemetry.observation_receipts SET maintenance_checked_at=$3 WHERE device_id=$1 AND observation_id=$2", [r.device_id, r.observation_id, time]);
          if (r.state === "stored") {
            if (r.expires_at <= time) { await expire(client, r); result.expired++; }
            return undefined;
          }
          if (r.state === "reserved" && (!r.lease_until || r.lease_until > time)) return undefined;
          if (r.expires_at <= time || r.captured_at.getTime() < time.getTime() - 7 * DAY || !await allowed(client, device, r)) {
            await expire(client, r); result.expired++; return undefined;
          }
          const day = time.toISOString().slice(0, 10);
          if (!await quota(client, r, day, maxDailyCount, maxDailyBytes)) { result.deferred++; return undefined; }
          await client.query(`UPDATE telemetry.observation_receipts SET state='reserved',lease_id=$3,lease_until=$4,reserved_day=$5
            WHERE device_id=$1 AND observation_id=$2`, [r.device_id, r.observation_id, leaseId, new Date(time.getTime() + 30_000), day]);
          return r;
        });
        if (!claim) continue;
        storagePhase = true;
        const object = await store.head(claim.object_key, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
        storagePhase = false;
        signal.throwIfAborted();
        const finalizedBytes = await transaction(client, async () => {
          const device = await lockDevice(client, claim.device_id);
          const r = await receipt(client, claim.device_id, claim.observation_id);
          const time = now();
          if (!r || r.state !== "reserved" || r.lease_id !== leaseId || !r.lease_until || r.lease_until <= time) { result.deferred++; return; }
          if (r.expires_at <= time || !await allowed(client, device, r)) { await expire(client, r); result.expired++; return; }
          if (!object) {
            await client.query("UPDATE telemetry.observation_receipts SET state='failed',lease_id=NULL,lease_until=NULL WHERE device_id=$1 AND observation_id=$2", [r.device_id, r.observation_id]);
            result.deferred++; return;
          }
          if (object.sha256 !== r.sha256 || object.fingerprint !== r.fingerprint || object.bytes !== r.bytes) {
            await expire(client, r); result.expired++; return;
          }
          const day = time.toISOString().slice(0, 10);
          if (r.reserved_day !== day || !await quota(client, r, day, maxDailyCount, maxDailyBytes)) { result.deferred++; return; }
          await client.query("UPDATE telemetry.observation_images SET generation=$3 WHERE device_id=$1 AND observation_id=$2", [r.device_id, r.observation_id, object.generation]);
          await client.query(`UPDATE telemetry.observation_receipts SET state='stored',received_at=$3,lease_id=NULL,lease_until=NULL
            WHERE device_id=$1 AND observation_id=$2`, [r.device_id, r.observation_id, time]);
          await client.query(`INSERT INTO telemetry.observation_usage(device_id,day,accepted_count,accepted_bytes) VALUES($1,$2,1,$3)
            ON CONFLICT(device_id,day) DO UPDATE SET accepted_count=observation_usage.accepted_count+1,accepted_bytes=observation_usage.accepted_bytes+EXCLUDED.accepted_bytes`, [r.device_id, day, r.bytes]);
          await client.query(`INSERT INTO telemetry.capability_presence(device_id,capability_id,last_capture_at,last_received_at) VALUES($1,$2,$3,$4)
            ON CONFLICT(device_id,capability_id) DO UPDATE SET last_capture_at=GREATEST(capability_presence.last_capture_at,EXCLUDED.last_capture_at),
              last_received_at=GREATEST(capability_presence.last_received_at,EXCLUDED.last_received_at)`, [r.device_id, r.capability_id, r.captured_at, time]);
          return r.bytes;
        });
        if (finalizedBytes !== undefined) {
          result.finalized++;
          try { options.onAccepted?.(finalizedBytes); } catch { /* log delivery cannot undo a confirmed commit */ }
        }
      } catch (error) { if (signal.aborted || !storagePhase) throw error; result.errors++; }
    }
    // Delete only after the upload deadline/grace. A crashed uploader that wrote
    // after device cascade is also caught by the independent orphan scan below.
    const deletions = (await client.query<{ object_key: string; generation: string | null }>(`SELECT object_key,generation FROM telemetry.observation_deletion_intents
      WHERE queued_at<=$1 ORDER BY last_attempt_at NULLS FIRST,queued_at,object_key LIMIT $2`, [new Date(now().getTime() - orphanGraceMs), limit])).rows;
    for (const intent of deletions) {
      signal.throwIfAborted();
      let storagePhase = false;
      try {
        await client.query("UPDATE telemetry.observation_deletion_intents SET last_attempt_at=$2,attempts=attempts+1 WHERE object_key=$1", [intent.object_key, now()]);
        // Writers reject this durable fence before reserving its key. Existing
        // metadata is a consistency alarm, never authority to delete live media.
        if ((await client.query("SELECT 1 FROM telemetry.observation_images WHERE object_key=$1", [intent.object_key])).rowCount) {
          result.errors++; continue;
        }
        const opSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
        storagePhase = true;
        const generation = intent.generation ?? (await store.head(intent.object_key, opSignal))?.generation;
        if (generation) await store.delete(intent.object_key, generation, opSignal);
        storagePhase = false;
        // Another producer can update an intent while object I/O is in flight.
        // Remove only the exact generation we originally selected.
        await client.query("DELETE FROM telemetry.observation_deletion_intents WHERE object_key=$1 AND generation IS NOT DISTINCT FROM $2", [intent.object_key, intent.generation]);
        result.deleted++;
      } catch (error) { if (signal.aborted || !storagePhase) throw error; result.errors++; }
    }
    signal.throwIfAborted();
    await client.query("INSERT INTO telemetry.observation_maintenance_state(id) VALUES(1) ON CONFLICT DO NOTHING");
    const token = (await client.query<{ orphan_page_token: string | null }>("SELECT orphan_page_token FROM telemetry.observation_maintenance_state WHERE id=1")).rows[0]!.orphan_page_token;
    const page = await store.list({ prefix: "tenant/", ...(token ? { pageToken: token } : {}), limit }, AbortSignal.any([signal, AbortSignal.timeout(20_000)])).catch(async error => {
      // A stale or invalid provider cursor must not permanently disable sweeps.
      await client.query("UPDATE telemetry.observation_maintenance_state SET orphan_page_token=NULL WHERE id=1");
      throw error;
    });
    for (const object of page.objects) {
      signal.throwIfAborted();
      const created = Date.parse(object.createdAt);
      if (!Number.isFinite(created) || created > now().getTime() - orphanGraceMs) continue;
      const device = objectIdentity(object.key)?.device;
      if (!device) continue;
      await transaction(client, async () => {
        if (device) await lockDevice(client, device);
        const present = await client.query("SELECT 1 FROM telemetry.observation_images WHERE object_key=$1", [object.key]);
        if (present.rowCount) return;
        await client.query(`INSERT INTO telemetry.observation_deletion_intents(object_key,generation) VALUES($1,$2)
          ON CONFLICT(object_key) DO UPDATE SET generation=COALESCE(observation_deletion_intents.generation,EXCLUDED.generation)`, [object.key, object.generation]);
        result.orphans++;
      });
    }
    await client.query("UPDATE telemetry.observation_maintenance_state SET orphan_page_token=$1 WHERE id=1", [page.nextPageToken]);
    signal.throwIfAborted();
    result.health = await observationHealth(client, now(), limit, signal);
    return result;
  } catch (error) { discard = true; throw error; }
  finally {
    if (locked) { try { await client.query("SELECT pg_advisory_unlock($1)", [WORKER_LOCK]); } catch { discard = true; } }
    client.release(discard);
  }
}
