import { createHash } from "node:crypto";
import { DeviceCapabilityStatus, ImageObservationMetadata, ImageObservationPage, LatestImageObservation, SensorCapabilityId } from "@albusforge/schema";
import { StorageNotFoundError, type ObservationStorage } from "@albusforge/storage";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { withAuthorizedRead } from "./authorized-read";
import { HttpError, parse } from "./http";

const Params = z.strictObject({ deviceId: z.uuid(), capabilityId: SensorCapabilityId });
const ContentParams = Params.extend({ observationId: z.uuidv4() });
const Cursor = Params.extend({ capturedAt: z.iso.datetime(), observationId: z.uuidv4() });
const Query = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(24), cursor: z.string().max(2048).optional() });
const columns = `r.device_id,r.capability_id,r.observation_id,r.kind,r.payload_schema AS schema,r.sha256,r.bytes,
  r.captured_at,r.received_at,r.expires_at,i.width,i.height,i.object_key,i.generation`;
interface ImageRow {
  device_id: string; capability_id: string; observation_id: string; kind: string; schema: string;
  sha256: string; bytes: number; captured_at: Date; received_at: Date; expires_at: Date;
  width: number; height: number; object_key: string; generation: string;
}
const projection = (row: ImageRow) => ImageObservationMetadata.parse({
  device_id: row.device_id, capability_id: row.capability_id, observation_id: row.observation_id, kind: row.kind, schema: row.schema,
  sha256: row.sha256, bytes: row.bytes, captured_at: row.captured_at.toISOString(), received_at: row.received_at.toISOString(), expires_at: row.expires_at.toISOString(), width: row.width, height: row.height,
});
const missing = () => new HttpError(404, "NOT_FOUND", "Image source not found");
async function authorizeSource(client: PoolClient, tenant: string, device: string, capability: string) {
  if (!(await client.query(`SELECT 1 FROM telemetry.devices d JOIN telemetry.device_capabilities c ON c.device_id=d.id
    WHERE d.id=$1 AND d.tenant_id=$2 AND c.capability_id=$3 AND c.kind='image'`, [device, tenant, capability])).rowCount) throw missing();
}
async function image(client: PoolClient, tenant: string, params: z.infer<typeof ContentParams>) {
  const row = (await client.query<ImageRow>(`SELECT ${columns} FROM telemetry.observation_receipts r
    JOIN telemetry.observation_images i USING(device_id,observation_id) JOIN telemetry.devices d ON d.id=r.device_id
    WHERE d.tenant_id=$1 AND r.device_id=$2 AND r.capability_id=$3 AND r.observation_id=$4
      AND r.state='stored' AND r.expires_at>statement_timestamp()`, [tenant, params.deviceId, params.capabilityId, params.observationId])).rows[0];
  if (!row) throw missing();
  return row;
}
export function registerObservationReads(app: FastifyInstance, pool: Pool, store: ObservationStorage) {
  app.register(async scope => {
    scope.addHook("onRequest", async (_request, reply) => { reply.header("cache-control", "private, no-store"); reply.header("x-content-type-options", "nosniff"); });
    scope.get("/v1/devices/:deviceId/capabilities", request => withAuthorizedRead(pool, request.headers.cookie, request.hostname, async (client, { tenantId }) => {
      const { deviceId } = parse(z.strictObject({ deviceId: z.uuid() }), request.params, "device");
      parse(z.strictObject({}), request.query, "query");
      if (!(await client.query("SELECT 1 FROM telemetry.devices WHERE id=$1 AND tenant_id=$2", [deviceId, tenantId])).rowCount) throw missing();
      const rows = (await client.query(`SELECT c.capability_id AS id,c.kind,c.payload_schema AS schema,c.enabled,c.required,c.interval_s,
        p.last_capture_at,p.last_received_at,CASE WHEN d.revoked_at IS NOT NULL THEN 'credential_revoked'
        WHEN NOT c.enabled THEN 'disabled' WHEN p.last_received_at IS NULL THEN 'waiting'
        WHEN LEAST(p.last_received_at,p.last_capture_at)>=statement_timestamp()-make_interval(secs=>CASE WHEN c.kind='image' THEN c.interval_s*2+300 ELSE GREATEST(60,c.interval_s*3) END) THEN 'healthy' ELSE 'stale' END AS status
        FROM telemetry.device_capabilities c JOIN telemetry.devices d ON d.id=c.device_id
        LEFT JOIN telemetry.capability_presence p USING(device_id,capability_id)
        WHERE d.tenant_id=$1 AND c.device_id=$2 ORDER BY c.capability_id LIMIT 64`, [tenantId, deviceId])).rows;
      return DeviceCapabilityStatus.parse({ device_id: deviceId, capabilities: rows.map(r => ({ ...r, last_capture_at: r.last_capture_at?.toISOString() ?? null, last_received_at: r.last_received_at?.toISOString() ?? null })) });
    }));
    scope.get("/v1/devices/:deviceId/capabilities/:capabilityId/images/latest", request => withAuthorizedRead(pool, request.headers.cookie, request.hostname, async (client, { tenantId }) => {
      const params = parse(Params, request.params, "source");
      parse(z.strictObject({}), request.query, "query");
      await authorizeSource(client, tenantId, params.deviceId, params.capabilityId);
      const row = (await client.query<ImageRow>(`SELECT ${columns} FROM telemetry.observation_receipts r JOIN telemetry.observation_images i USING(device_id,observation_id)
        WHERE r.device_id=$1 AND r.capability_id=$2 AND r.state='stored' AND r.expires_at>statement_timestamp()
        ORDER BY r.captured_at DESC,r.observation_id DESC LIMIT 1`, [params.deviceId, params.capabilityId])).rows[0];
      return LatestImageObservation.parse({ image: row ? projection(row) : null });
    }));
    scope.get("/v1/devices/:deviceId/capabilities/:capabilityId/images", request => withAuthorizedRead(pool, request.headers.cookie, request.hostname, async (client, { tenantId }) => {
      const params = parse(Params, request.params, "source");
      const query = parse(Query, request.query, "query");
      await authorizeSource(client, tenantId, params.deviceId, params.capabilityId);
      let cursor: z.infer<typeof Cursor> | undefined;
      if (query.cursor) {
        try { cursor = Cursor.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"))); }
        catch { throw new HttpError(400, "BAD_REQUEST", "Invalid image cursor"); }
        if (cursor.deviceId !== params.deviceId || cursor.capabilityId !== params.capabilityId) throw new HttpError(400, "BAD_REQUEST", "Cursor belongs to another source");
      }
      const rows = (await client.query<ImageRow>(`SELECT ${columns} FROM telemetry.observation_receipts r JOIN telemetry.observation_images i USING(device_id,observation_id)
        WHERE r.device_id=$1 AND r.capability_id=$2 AND r.state='stored' AND r.expires_at>statement_timestamp()
          AND ($3::timestamptz IS NULL OR (r.captured_at,r.observation_id)<($3::timestamptz,$4::uuid))
        ORDER BY r.captured_at DESC,r.observation_id DESC LIMIT $5`, [params.deviceId, params.capabilityId, cursor?.capturedAt ?? null, cursor?.observationId ?? null, query.limit+1])).rows;
      const page = rows.slice(0, query.limit), last = page.at(-1);
      return ImageObservationPage.parse({ images: page.map(projection), next_cursor: rows.length>query.limit && last ? Buffer.from(JSON.stringify({ ...params, capturedAt: last.captured_at.toISOString(), observationId: last.observation_id })).toString("base64url") : null });
    }));
    scope.get("/v1/devices/:deviceId/capabilities/:capabilityId/images/:observationId/content", async (request, reply) => {
      const params = parse(ContentParams, request.params, "image");
      parse(z.strictObject({}), request.query, "query");
      const authorize = () => withAuthorizedRead(pool, request.headers.cookie, request.hostname, async (client, { tenantId }) => {
        await authorizeSource(client, tenantId, params.deviceId, params.capabilityId);
        return image(client, tenantId, params);
      });
      const row = await authorize();
      const abort = new AbortController();
      reply.raw.once("close", () => abort.abort());
      let bytes: Buffer;
      try { bytes = await store.read(row.object_key, row.generation, AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)])); }
      catch (error) { if (error instanceof StorageNotFoundError) throw missing(); throw new HttpError(503, "UNAVAILABLE", "Image temporarily unavailable"); }
      // Release SQL during object I/O, then recheck current session, membership, expiry and object identity.
      const current = await authorize();
      if (current.generation !== row.generation || current.sha256 !== row.sha256 || bytes.length !== row.bytes || createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new HttpError(503, "UNAVAILABLE", "Image temporarily unavailable");
      return reply.type("image/jpeg").send(bytes);
    });
  });
}
