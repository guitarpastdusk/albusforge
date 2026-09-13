import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { Pool } from "pg";
import { registerTelemetry } from "./routes.js";

export type Log = (entry: Record<string, unknown>) => void;
export function buildApp({ pool, now, maxInflight = 8, readyTimeoutMs = 2000, log = (entry) => console.log(JSON.stringify(entry)) }: {
  pool: Pool; now?: () => Date; maxInflight?: number; readyTimeoutMs?: number; log?: Log;
}) {
  const app = Fastify({ logger: false, genReqId: () => randomUUID(), requestIdHeader: false, requestTimeout: 60_000 });
  app.addHook("onRequest", async (request, reply) => { reply.header("x-request-id", request.id); });
  app.addHook("onResponse", async (request, reply) => {
    if (["/healthz", "/readyz"].includes(request.routeOptions.url ?? "") && reply.statusCode < 500) return;
    // No headers, body, query values, tokens or database error text.
    log({ severity: reply.statusCode >= 500 ? "WARNING" : "INFO", message: "request completed", requestId: request.id,
      method: request.method, route: request.routeOptions.url ?? null, status: reply.statusCode, durationMs: Math.round(reply.elapsedTime) });
  });
  app.setErrorHandler((_error, _request, reply) => reply.code(503).send({ error: { code: "unavailable", message: "Service unavailable" } }));
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async (_request, reply) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([pool.query("SELECT 1"), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("readiness timeout")), readyTimeoutMs);
      })]);
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ error: { code: "unavailable", message: "Database unavailable" } });
    } finally { clearTimeout(timer); }
  });
  app.register(async (scope) => registerTelemetry(scope, pool, now, maxInflight, log));
  return app;
}
