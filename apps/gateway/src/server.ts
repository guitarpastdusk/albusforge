/*
 * The gateway process: node apps/gateway/dist/server.js (the gateway image).
 *
 * Startup fails fast on invalid config. SIGTERM (Cloud Run scale-in or a new
 * revision) stops accepting connections, lets in-flight requests finish, closes
 * the pool and exits; Cloud Run allows 10 seconds, so a hung close exits first.
 */
import { createDb } from "@albusforge/db";
import { buildApp } from "./app";
import { configFromEnv } from "./config";
import { createLogger } from "./log";
import { createPartsStore } from "./parts";

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

  // A small pool: Cloud SQL's connection limit is per instance, shared by every Cloud Run instance.
  const { db, pool } = createDb(config.db, { max: 5 });
  // An idle client losing its connection emits on the pool; unhandled, that crashes the process.
  pool.on("error", (error) => log("ERROR", "idle database client error", { error }));

  const app = buildApp({
    parts: createPartsStore(db),
    ping: async () => {
      await pool.query("SELECT 1");
    },
    log,
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
    fields: { port: config.port, dbHost: config.db.host, dbName: config.db.database, dbUser: config.db.user },
  });
}

void main();
