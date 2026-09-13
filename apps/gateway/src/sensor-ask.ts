import { AskRequest, AskResponse, SensorAskInput, SensorAskResponse, routes, type SensorAskRequest } from "@albusforge/schema";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { HttpError, parse } from "./http";
import type { AuthHeader } from "./intake";
import { withSession } from "./session";
import { RateLimiter } from "./rate-limit";

export interface SensorAskClient { ask(input: SensorAskRequest, signal: AbortSignal): Promise<SensorAskResponse> }
export function httpSensorAskClient(url: string, authHeader: AuthHeader, fetchImpl: typeof fetch = fetch): SensorAskClient {
  const endpoint = new URL("/v1/ask", url);
  return { async ask(input, signal) {
    const authorization = await authHeader();
    signal.throwIfAborted();
    const response = await fetchImpl(endpoint, { method: "POST", redirect: "error", signal, headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: JSON.stringify(input) });
    if (!response.ok) {
      await response.body?.cancel();
      const allowed: Record<number, [string, string]> = { 403: ["FORBIDDEN", "Sensor access denied"], 404: ["NOT_FOUND", "Sensor or channel not found"], 410: ["HISTORY_EXPIRED", "Choose a more recent time window"], 422: ["TOO_MANY_POINTS", "Choose a narrower time window"], 429: ["BUSY", "Sensor chat is busy; try again shortly"] };
      const error = allowed[response.status];
      if (error) throw new HttpError(response.status, error[0], error[1]);
      throw new Error("Ask unavailable");
    }
    // Bounded read, even if the upstream omits or lies about Content-Length.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Ask response");
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65536) throw new Error("Ask response too large"); chunks.push(value); } }
    finally { await reader.cancel().catch(() => undefined); }
    const result = SensorAskResponse.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (result.request_id !== input.request_id || result.device_id !== input.device_id || result.channel !== input.channel || Date.parse(result.evidence.from) !== Date.parse(input.from) || Date.parse(result.evidence.to) !== Date.parse(input.to)) throw new Error("Ask scope mismatch");
    return result;
  } };
}
export function registerSensorAsk(app: FastifyInstance, pool: Pool, ask: SensorAskClient | null, timeoutMs = 35000) {
  const limiter = new RateLimiter(20, 60000);
  app.post(routes.devices.ask.pattern, { bodyLimit: 16384 }, async (req, reply) => {
    reply.header("cache-control", "private, no-store");
    const input = await withSession(pool, req.headers.cookie, req.hostname, async (client, tenant, actor) => {
      const { id } = parse(z.strictObject({ id: z.uuid() }), req.params, "device");
      parse(z.strictObject({}), req.query, "query");
      const body = parse(AskRequest.strict(), req.body, "question");
      const query = parse(SensorAskInput, { question: body.text, channel: body.channel, from: body.from, to: body.to }, "sensor query");
      const device = await client.query("SELECT 1 FROM telemetry.devices WHERE id=$1 AND tenant_id=$2 AND channels ? $3", [id, tenant, query.channel]);
      if (!device.rowCount) throw new HttpError(404, "NOT_FOUND", "Sensor or channel not found");
      if (limiter.take(actor)) throw new HttpError(429, "BUSY", "Too many questions; try again shortly");
      return { ...query, request_id: req.id, device_id: id, tenant_id: tenant, actor_id: actor };
    });
    if (!ask) throw new HttpError(503, "UNAVAILABLE", "Sensor chat is not configured");
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const abort = () => controller.abort();
    req.raw.on("aborted", abort);
    try {
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Ask deadline")); }, timeoutMs); });
      const result = await Promise.race([ask.ask(input, controller.signal), deadline]);
      return AskResponse.parse({ message: { id: result.request_id, role: "assistant", created_at: new Date().toISOString(), text: [result.answer, `Evidence: ${result.channel}, ${result.evidence.from} to ${result.evidence.to} (end exclusive), ${result.evidence.count} readings, unit ${result.evidence.unit}. Latest means latest in this window.`, ...result.limitations].join("\n\n") }, queries: [{ tool: "sensor_window_summary", input: { device_id: input.device_id, channel: input.channel, from: input.from, to: input.to } }] });
    } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(503, "UNAVAILABLE", "Sensor chat is unavailable; try again shortly"); }
    finally { clearTimeout(timer); req.raw.off("aborted", abort); controller.abort(); }
  });
}
