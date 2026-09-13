import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { TelemetryAck, TelemetryChannels, TelemetryEnvelope } from "@albusforge/schema";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
class IngestError extends Error {
  constructor(readonly statusCode: number, readonly code: string) { super(code); }
}

/** All tenant attribution comes from the authenticated device, never the wire. */
export function registerTelemetry(app: FastifyInstance, pool: Pool, now: () => Date = () => new Date(), maxInflight = 8) {
  app.setErrorHandler((error, _request, reply) => {
    // Never log driver errors: they can contain values from parameterized SQL.
    const code = (error as { statusCode?: number }).statusCode;
    const status = error instanceof IngestError ? error.statusCode
      : typeof code === "number" && code >= 400 && code < 500 ? code : 503;
    reply.code(status).send({ error: { code: error instanceof IngestError ? error.code : status < 500 ? "invalid_request" : "storage_unavailable", message: status < 500 ? "Telemetry request rejected" : "Telemetry storage unavailable" } });
  });
  const ingest = async (request: FastifyRequest, reply: FastifyReply) => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "");
    if (!match) throw new IngestError(401, "unauthorized");
    const parsed = TelemetryEnvelope.safeParse(request.body);
    if (!parsed.success) throw new IngestError(400, "invalid_envelope");
    const envelope = parsed.data;
    // Zod constructs objects in schema order; object key order is irrelevant on retries.
    const canonical = JSON.stringify(envelope);
    const fingerprint = tokenHash(canonical);
    const received = now();
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      // Serializes packets and credential revocation per device, including concurrent retries.
      const device = (await client.query<{ channels: unknown; next_s: number }>(
        "SELECT channels, next_s FROM telemetry.devices WHERE id=$1 AND token_hash=$2 AND revoked_at IS NULL FOR UPDATE",
        [envelope.dev, tokenHash(match[1]!)],
      )).rows[0];
      if (!device) throw new IngestError(401, "unauthorized");
      const prior = (await client.query<{ fingerprint: string; response: unknown }>(
        "SELECT fingerprint, response FROM telemetry.packets WHERE device_id=$1 AND seq=$2", [envelope.dev, envelope.seq],
      )).rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new IngestError(409, "sequence_conflict");
        await client.query("COMMIT");
        return reply.code(202).send(TelemetryAck.parse(prior.response));
      }
      const channels = TelemetryChannels.parse(device.channels);
      const seconds = Math.floor(received.getTime() / 1000);
      const validTime = (t: number) => t >= seconds - 90 * 86400 && t <= seconds + 300;
      if (!validTime(envelope.ts)) throw new IngestError(422, "timestamp_out_of_range");
      const normalized = envelope.r.map((r, ordinal) => {
        const channel = Object.hasOwn(channels, r.c) ? channels[r.c] : undefined;
        if (!channel) throw new IngestError(422, "unknown_channel");
        if (r.v < channel.min || r.v > channel.max) throw new IngestError(422, "value_out_of_range");
        const ts = r.t < 0 ? envelope.ts + r.t : r.t;
        if (!validTime(ts) || ts > envelope.ts) throw new IngestError(422, "timestamp_out_of_range");
        return { ...r, ordinal, ts: new Date(ts * 1000) };
      });
      const response = TelemetryAck.parse({ ok: normalized.length, next_s: device.next_s, cmd: [] });
      await client.query("INSERT INTO telemetry.packets(device_id,seq,fingerprint,response) VALUES($1,$2,$3,$4)",
        [envelope.dev, envelope.seq, fingerprint, response]);
      // One bounded bulk write per table, not one network round trip per sample.
      const data = JSON.stringify(normalized.map((r) => ({ channel: r.c, ts: r.ts.toISOString(), value: r.v, ordinal: r.ordinal })));
      await client.query(`INSERT INTO telemetry.readings(device_id,seq,ordinal,channel,ts,value)
        SELECT $1,$2,ordinal,channel,ts,value FROM jsonb_to_recordset($3::jsonb)
        AS r(ordinal integer,channel text,ts timestamptz,value double precision)`, [envelope.dev, envelope.seq, data]);
      await client.query(`INSERT INTO telemetry.latest(device_id,channel,ts,seq,ordinal,value)
        SELECT DISTINCT ON (channel) $1,channel,ts,$2,ordinal,value FROM jsonb_to_recordset($3::jsonb)
        AS r(ordinal integer,channel text,ts timestamptz,value double precision)
        ORDER BY channel,ts DESC,ordinal DESC
        ON CONFLICT(device_id,channel) DO UPDATE SET ts=EXCLUDED.ts,seq=EXCLUDED.seq,ordinal=EXCLUDED.ordinal,value=EXCLUDED.value
        WHERE (EXCLUDED.ts,EXCLUDED.seq,EXCLUDED.ordinal) > (latest.ts,latest.seq,latest.ordinal)`, [envelope.dev, envelope.seq, data]);
      await client.query(`UPDATE telemetry.devices SET last_seen_at=GREATEST(last_seen_at,$2),
        status=CASE WHEN last_seq IS NULL OR last_seq < $3 THEN $4::jsonb ELSE status END,
        last_seq=GREATEST(last_seq,$3) WHERE id=$1`, [envelope.dev, received, envelope.seq, envelope.st]);
      await client.query(`INSERT INTO telemetry.usage(device_id,period,readings_in,payload_bytes) VALUES($1,$2,$3,$4)
        ON CONFLICT(device_id,period) DO UPDATE SET readings_in=usage.readings_in+EXCLUDED.readings_in,
        payload_bytes=usage.payload_bytes+EXCLUDED.payload_bytes`,
        [envelope.dev, received.toISOString().slice(0, 7), normalized.length, Buffer.byteLength(canonical)]);
      await client.query("COMMIT");
      return reply.code(202).send(response);
    } catch (error) {
      // A client-side query timeout may leave the connection protocol unsettled.
      // Discard on every unexpected failure, even if ROLLBACK appears to succeed.
      discard = !(error instanceof IngestError);
      try { await client.query("ROLLBACK"); } catch { discard = true; }
      if ((error as { constraint?: string }).constraint === "telemetry_retention_bound") throw new IngestError(422, "timestamp_out_of_range");
      throw error;
    } finally {
      client.release(discard);
    }
  };
  let inflight = 0;
  app.post("/ingest/v1", { bodyLimit: 128 * 1024 }, async (request, reply) => {
    if (inflight >= maxInflight) return reply.code(503).header("retry-after", "1").send({ error: { code: "busy", message: "Retry this packet later" } });
    inflight++;
    try { return await ingest(request, reply); } finally { inflight--; }
  });
}
