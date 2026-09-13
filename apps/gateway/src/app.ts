import { randomUUID } from "node:crypto";
import {
  DEFAULT_PART_STATUSES,
  PartDetail,
  PartList,
  PartParams,
  PartQuery,
  PartsQuery,
  routes,
  summarizePart,
} from "@albusforge/schema";
import Fastify, { type FastifyInstance } from "fastify";
import { type AuthOptions, registerAuthRoutes } from "./auth-routes";
import { type ChatOptions, registerBuildRoutes } from "./build-routes";
import { isDatabaseUnavailable } from "./db-errors";
import { describeError } from "./db-log";
import { HttpError, parse, pathOf, sendError } from "./http";
import { createLogger, type Log, type TraceContext, traceFromHeaders } from "./log";
import type { PartsStore } from "./parts";
import type { Pool } from "pg";
import { registerTelemetryReads } from "./telemetry-read";
import { registerUsageRoutes } from "./usage-routes";

import { registerSensorAsk, type SensorAskClient } from "./sensor-ask";

export { HttpError } from "./http";

declare module "fastify" {
  interface FastifyRequest {
    trace?: TraceContext;
  }
}

export interface AppOptions {
  /** Production supplies the same bounded PostgreSQL pool used by other gateway reads. */
  telemetryPool?: Pool;
  sensorAsk?: SensorAskClient | null;
  parts: PartsStore;
  /** Resolves when the database answers; rejects otherwise. */
  ping: () => Promise<void>;
  log?: Log;
  /** How long /readyz waits for the ping. */
  readyTimeoutMs?: number;
  /**
   * The build and chat routes. server.ts always passes it; tests that only
   * exercise health and parts leave it out, and the build routes stay 501.
   */
  chat?: ChatOptions;
  /** The sign-in routes (ADR 0008). Left out, they stay 501 like the build routes. */
  auth?: AuthOptions;
}

const HEALTH_PATHS = new Set(["/healthz", "/readyz"]);

/** The innermost `cause`. */
function rootCause(error: unknown): unknown {
  let current = error;
  for (let depth = 0; current instanceof Error && current.cause !== undefined && depth < 5; depth++) current = current.cause;
  return current;
}

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function buildApp({ parts, ping, log = createLogger(), readyTimeoutMs = 2000, chat, auth, telemetryPool, sensorAsk = null }: AppOptions): FastifyInstance {
  const app = Fastify({
    // Logging is ours (log.ts): Fastify's pino lines don't carry Cloud Logging's fields.
    logger: false,
    // Never taken from a client header, so a request id can't be forged into logs.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  });

  app.addHook("onRequest", async (request, reply) => {
    request.trace = traceFromHeaders(request.headers);
    reply.header("x-request-id", request.id);
  });

  // One line per request: method, route pattern, path, status, duration. No
  // headers, cookies, query values or bodies. An event stream logs when it ends.
  app.addHook("onResponse", async (request, reply) => {
    const path = pathOf(request.url);
    if (HEALTH_PATHS.has(path) && reply.statusCode < 500) return;
    // 501 is the expected answer for routes not built yet, not a server fault.
    const fault = reply.statusCode >= 500 && reply.statusCode !== 501;
    log(fault ? "WARNING" : "INFO", "request completed", {
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
    if (error instanceof HttpError) {
      if (error.headers) reply.headers(error.headers);
      return sendError(reply, error.statusCode, error.code, error.message, error.details);
    }

    // Fastify's own 4xx errors: malformed URL, unsupported content type, body too large.
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return sendError(reply, status, "BAD_REQUEST", (error as Error).message);
    }

    // A stalled or unreachable database: the pool's timeouts fired and the
    // client was discarded. Logged without Drizzle's wrapper, which carries the
    // SQL and its parameters.
    if (isDatabaseUnavailable(error)) {
      log("WARNING", "database unavailable", {
        error: rootCause(error),
        trace: request.trace,
        fields: { requestId: request.id, method: request.method, route: request.routeOptions.url ?? null, path: pathOf(request.url) },
      });
      return sendError(reply, 503, "UNAVAILABLE", "Database unavailable", { request_id: request.id });
    }

    // Any other database error: only its SQLSTATE and location (db-log.ts),
    // never Drizzle's message, which carries the query parameters.
    const described = describeError(error);
    log("ERROR", "request failed", {
      error: described.error,
      trace: request.trace,
      fields: {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? null,
        path: pathOf(request.url),
        ...described.fields,
      },
    });
    // The message stays in the log; the client gets the request id to quote.
    return sendError(reply, 500, "INTERNAL", "Internal server error", { request_id: request.id });
  });

  // Every /v1 route that isn't built yet answers JSON, so the portal can tell
  // "not implemented" from an HTML error page. Unknown paths elsewhere are 404.
  app.setNotFoundHandler((request, reply) => {
    const path = pathOf(request.url);
    if (path === "/v1" || path.startsWith("/v1/")) {
      return sendError(reply, 501, "NOT_IMPLEMENTED", `${request.method} ${path} is not implemented`);
    }
    return sendError(reply, 404, "NOT_FOUND", "Not found");
  });

  // Liveness: the process is serving. Never touches the database.
  app.get("/healthz", async () => ({ status: "ok" }));

  // Readiness: the database answers.
  app.get("/readyz", async (request, reply) => {
    try {
      await withTimeout(ping(), readyTimeoutMs);
      return { status: "ok" };
    } catch (error) {
      log("WARNING", "readiness check failed", { error, trace: request.trace, fields: { requestId: request.id } });
      return sendError(reply, 503, "UNAVAILABLE", "Database unavailable");
    }
  });

  app.get(routes.parts.list.pattern, async (request) => {
    const query = parse(PartsQuery, request.query, "query");
    const found = await parts.latest({ statuses: query.status ?? DEFAULT_PART_STATUSES, category: query.category });
    return PartList.parse({ parts: found.map(summarizePart) });
  });

  app.get(routes.parts.get.pattern, async (request) => {
    const { id } = parse(PartParams, request.params, "part id");
    const query = parse(PartQuery, request.query, "query");
    const statuses = query.status ?? DEFAULT_PART_STATUSES;
    const [part] = await parts.latest({ statuses, id });
    if (!part) throw new HttpError(404, "NOT_FOUND", `No part ${id} with status ${statuses.join(" or ")}`);
    return PartDetail.parse({ part });
  });

  if (chat) {
    // With sign-in wired, a session cookie makes the build routes tenant-scoped.
    const sessions = chat.sessions ?? (auth ? { tenantOf: (token: string) => auth.store.sessionTenant(token) } : undefined);
    registerBuildRoutes(app, { parts, log, chat: { ...chat, sessions } });
  }
  if (auth) registerAuthRoutes(app, { log, auth });
  if (telemetryPool) {
    registerTelemetryReads(app, telemetryPool);
    registerUsageRoutes(app, telemetryPool);
    registerSensorAsk(app, telemetryPool, sensorAsk);
  }

  return app;
}
