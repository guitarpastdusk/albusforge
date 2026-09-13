/*
 * The intake process: node apps/intake/dist/server.js (the intake image).
 *
 * Startup fails fast on invalid config, a missing prompt, or LLM_PROVIDER=vertex.
 * SIGTERM stops accepting connections and drains; Cloud Run allows 10 s, so a
 * turn still waiting on the model past that is cut off without a reply. The
 * gateway's retry of POST /v1/turns answers it.
 */
import { createDb } from "@albusforge/db";
import { buildTokensUsed, createMeter, createProvider, llmCallsInserter } from "@albusforge/llm";
import { buildApp } from "./app";
import { createCatalogueCache, dbPartsSource } from "./catalogue";
import { configFromEnv } from "./config";
import { handleTurn } from "./handler";
import { createLogger } from "./log";
import { loadPrompts } from "./prompts";

const SHUTDOWN_GRACE_MS = 8000;

async function main(): Promise<void> {
  const log = createLogger();

  process.on("unhandledRejection", (reason) => {
    log("CRITICAL", "unhandled rejection", { error: reason });
    process.exit(1);
  });

  let config, provider, prompts;
  try {
    config = configFromEnv();
    prompts = loadPrompts();
    provider = createProvider(config.llm.provider, { apiKey: config.llm.apiKey, timeoutMs: config.turnDeadlineMs });
  } catch (error) {
    log("CRITICAL", "invalid configuration", { error });
    process.exit(1);
  }

  const { connectMs, queryMs, readMs, idleMs } = config.dbTimeouts;
  const { db, pool } = createDb(config.db, {
    max: 5,
    connectTimeoutMs: connectMs,
    statementTimeoutMs: queryMs,
    queryTimeoutMs: readMs,
    idleTimeoutMs: idleMs,
  });
  pool.on("error", (error) => log("ERROR", "idle database client error", { error }));

  const meter = createMeter({
    insert: llmCallsInserter(db),
    onUnknownModel: (model) => log("WARNING", "model missing from the price table; priced at the most expensive row", { fields: { model } }),
  });
  const catalogue = createCatalogueCache({
    source: dbPartsSource(db),
    includeDrafts: config.registryIncludeDrafts,
    onLoad: (snapshot) =>
      log(snapshot.partCount === 0 ? "WARNING" : "INFO", "part catalogue loaded", {
        fields: { parts: snapshot.partCount, capabilities: snapshot.vocabulary.capabilities.size, includeDrafts: config.registryIncludeDrafts },
      }),
  });

  const deps = {
    db,
    pool,
    log,
    deadlineMs: config.turnDeadlineMs,
    turn: {
      provider,
      model: config.llm.model,
      effort: config.llm.effort,
      meter,
      catalogue,
      prompts,
      tokenCeiling: config.buildTokenCeiling,
      tokensUsed: (buildId: string) => buildTokensUsed(db, buildId),
      log,
    },
  };

  const app = buildApp({
    turns: (buildId, trace) => handleTurn(deps, buildId, trace),
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
  // Never the API key or the database password.
  log("INFO", "intake listening", {
    fields: {
      port: config.port,
      dbHost: config.db.host,
      dbName: config.db.database,
      dbUser: config.db.user,
      llmProvider: config.llm.provider,
      llmModel: config.llm.model,
      llmEffort: config.llm.effort,
      registryIncludeDrafts: config.registryIncludeDrafts,
      buildTokenCeiling: config.buildTokenCeiling,
      turnDeadlineMs: config.turnDeadlineMs,
    },
  });
}

void main();
