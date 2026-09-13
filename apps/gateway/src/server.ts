/*
 * The gateway process: node apps/gateway/dist/server.js (the gateway image).
 *
 * Startup fails fast on invalid config. SIGTERM (Cloud Run scale-in or a new
 * revision) stops accepting connections, lets in-flight requests finish, closes
 * the pool and exits; Cloud Run allows 10 seconds, so a hung close exits first.
 */
import { createDb } from "@albusforge/db";
import { buildApp } from "./app";
import { createAuthStore } from "./auth-store";
import { createChatStore } from "./chat-store";
import { configFromEnv } from "./config";
import { logEmailSender, resendEmailSender } from "./email";
import { createTurnScheduler, googleIdTokenAuth, httpIntakeClient } from "./intake";
import { googleInternalAuthVerifier, untrustingVerifier } from "./internal-auth";
import { createLogger } from "./log";
import { createPartsStore } from "./parts";
import { RateLimiter } from "./rate-limit";
import { newSessionToken } from "./session-cookie";

const SHUTDOWN_GRACE_MS = 8000;

async function main(): Promise<void> {
  const log = createLogger();

  process.on("unhandledRejection", (reason) => {
    log("CRITICAL", "unhandled rejection", { error: reason });
    process.exit(1);
  });

  let config;
  try {
    config = configFromEnv();
  } catch (error) {
    log("CRITICAL", "invalid configuration", { error });
    process.exit(1);
  }

  // A small pool: Cloud SQL's connection limit is per instance, shared by every
  // Cloud Run instance. Every wait is bounded, so a stalled database fails
  // requests with a 503 and frees their clients instead of exhausting the pool.
  const { connectMs, queryMs, readMs, idleMs } = config.dbTimeouts;
  const { db, pool } = createDb(config.db, {
    max: 5,
    connectTimeoutMs: connectMs,
    statementTimeoutMs: queryMs,
    queryTimeoutMs: readMs,
    idleTimeoutMs: idleMs,
  });
  // An idle client losing its connection emits on the pool; unhandled, that crashes the process.
  pool.on("error", (error) => log("ERROR", "idle database client error", { error }));

  // Gateway runs with CPU always allocated, so a turn keeps running after the
  // 201/202 has gone out. Intake is idempotent: a turn lost to a shutdown is
  // picked up by the next message.
  const { url: intakeUrl, auth: intakeAuth } = config.intake;
  const intake =
    intakeUrl === null
      ? null
      : httpIntakeClient({ url: intakeUrl, authHeader: intakeAuth === "google" ? googleIdTokenAuth(intakeUrl) : async () => undefined });
  if (intake === null) log("WARNING", "INTAKE_URL is not set: messages are stored but get no reply");

  // Sign-in (ADR 0008). The log adapter prints codes: never the production setting.
  const { auth: authConfig } = config;
  if (authConfig.emailAdapter === "log") log("WARNING", "EMAIL_ADAPTER=log: sign-in codes are written to the log, not emailed");
  if (authConfig.internalAuth === null) log("WARNING", "INTERNAL_AUTH_AUDIENCE is not set: X-Albus-Client-IP is ignored and SSR requests rate-limit as web's own IP");
  const email =
    authConfig.emailAdapter === "resend"
      ? resendEmailSender({ apiKey: authConfig.resendApiKey!, from: authConfig.emailFrom })
      : logEmailSender(log);
  const fifteenMinutesMs = 15 * 60_000;

  const app = buildApp({
    telemetryPool: pool,
    parts: createPartsStore(db),
    ping: async () => {
      await pool.query("SELECT 1");
    },
    log,
    chat: {
      store: createChatStore(db),
      turns: createTurnScheduler({ intake, log }),
      includeDrafts: config.registryIncludeDrafts,
      rateLimits: { anonOwners: new RateLimiter(config.anonBuildsPerHour, 60 * 60_000) },
      streamLimits: config.sseStreamLimits,
    },
    auth: {
      store: createAuthStore(db, { newSessionToken }),
      email,
      internalAuth: authConfig.internalAuth === null ? untrustingVerifier : googleInternalAuthVerifier(authConfig.internalAuth),
      trustedProxyHops: authConfig.trustedProxyHops,
      rateLimits: {
        codesPerEmail: new RateLimiter(authConfig.codesPerEmail, fifteenMinutesMs),
        codesPerIp: new RateLimiter(authConfig.codesPerIp, fifteenMinutesMs),
        verifiesPerIp: new RateLimiter(authConfig.verifiesPerIp, fifteenMinutesMs),
      },
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("INFO", "shutting down", { fields: { signal } });
    setTimeout(() => {
      log("ERROR", "shutdown timed out", { fields: { graceMs: SHUTDOWN_GRACE_MS } });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
    try {
      await app.close();
      await pool.end();
      log("INFO", "shutdown complete");
    } catch (error) {
      log("ERROR", "shutdown failed", { error });
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", (signal) => void shutdown(signal));
  process.once("SIGINT", (signal) => void shutdown(signal));

  await app.listen({ port: config.port, host: "0.0.0.0" });
  // Where it listens and as whom it connects; never the password.
  log("INFO", "gateway listening", {
    fields: {
      port: config.port,
      dbHost: config.db.host,
      dbName: config.db.database,
      dbUser: config.db.user,
      dbTimeoutsMs: config.dbTimeouts,
    },
  });
}

void main();
