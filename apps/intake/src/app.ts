import { randomUUID } from "node:crypto";
import { type ApiError, IntakeTurnRequest, IntakeTurnResponse } from "@albusforge/schema";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { isDatabaseUnavailable, TurnRetryableError } from "./db-errors";
import { createLogger, type Log, type TraceContext, traceFromHeaders } from "./log";

/**
 * intake's HTTP surface. Internal ingress only: Cloud Run's IAM check admits
 * gateway's ID token before a request gets here, so there is no auth code.
 */

declare module "fastify" {
  interface FastifyRequest {
    trace?: TraceContext;
  }
}

export interface AppOptions {
  /** Resolves the turn; null when the build doesn't exist. */
  turns: (buildId: string, trace?: TraceContext, mayRetry?: boolean) => Promise<IntakeTurnResponse | null>;
  ping: () => Promise<void>;
  log?: Log;
  readyTimeoutMs?: number;
}

const HEALTH_PATHS = new Set(["/healthz", "/readyz"]);

function sendError(reply: FastifyReply, status: number, code: string, message: string, details?: unknown) {
  const body: ApiError = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  return reply.code(status).type("application/json; charset=utf-8").send(body);
}

function rootCause(error: unknown): unknown {
  let current = error;
  for (let depth = 0; current instanceof Error && current.cause !== undefined && depth < 5; depth++) current = current.cause;
  return current;
}

const pathOf = (url: string) => url.split("?", 1)[0] ?? url;

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function buildApp({ turns, ping, log = createLogger(), readyTimeoutMs = 2000 }: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false, genReqId: () => randomUUID(), requestIdHeader: false, bodyLimit: 4096 });

  app.addHook("onRequest", async (request, reply) => {
    request.trace = traceFromHeaders(request.headers);
    reply.header("x-request-id", request.id);
  });

  app.addHook("onResponse", async (request, reply) => {
    const path = pathOf(request.url);
    if (HEALTH_PATHS.has(path) && reply.statusCode < 500) return;
    log(reply.statusCode >= 500 ? "WARNING" : "INFO", "request completed", {
      trace: request.trace,
      fields: {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? null,
        path,
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime * 10) / 10,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) return sendError(reply, status, "BAD_REQUEST", (error as Error).message);
    const fields = { requestId: request.id, method: request.method, route: request.routeOptions.url ?? null, path: pathOf(request.url) };
    if (error instanceof TurnRetryableError) {
      log("WARNING", "turn handed back for a retry", { error: rootCause(error), trace: request.trace, fields: { ...fields, reason: error.reason } });
      return sendError(reply, 503, "UNAVAILABLE", "Turn failed; retry", { request_id: request.id });
    }
    if (isDatabaseUnavailable(error)) {
      log("WARNING", "database unavailable", { error: rootCause(error), trace: request.trace, fields });
      return sendError(reply, 503, "UNAVAILABLE", "Database unavailable", { request_id: request.id });
    }
    log("ERROR", "request failed", { error, trace: request.trace, fields });
    return sendError(reply, 500, "INTERNAL", "Internal server error", { request_id: request.id });
  });

  app.setNotFoundHandler((_request, reply) => sendError(reply, 404, "NOT_FOUND", "Not found"));

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (request, reply) => {
    try {
      await withTimeout(ping(), readyTimeoutMs);
      return { status: "ok" };
    } catch (error) {
      log("WARNING", "readiness check failed", { error, trace: request.trace, fields: { requestId: request.id } });
      return sendError(reply, 503, "UNAVAILABLE", "Database unavailable");
    }
  });

  app.post("/v1/turns", async (request, reply) => {
    const body = IntakeTurnRequest.safeParse(request.body);
    if (!body.success) {
      const details = body.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
      return sendError(reply, 400, "BAD_REQUEST", "Invalid body", details);
    }
    const result = await turns(body.data.build_id, request.trace, body.data.may_retry);
    if (result === null) return sendError(reply, 404, "NOT_FOUND", "No such build");
    return IntakeTurnResponse.parse(result);
  });

  return app;
}
