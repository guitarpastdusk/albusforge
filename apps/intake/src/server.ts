/*
 * The intake process: node apps/intake/dist/server.js (the intake image).
 *
 * Startup fails fast on invalid config, a missing prompt, or LLM_PROVIDER=vertex.
 * SIGTERM stops accepting connections and drains; Cloud Run allows 10 s, so a
 * turn still waiting on the model past that is cut off without a reply. The
 * gateway's retry of POST /v1/turns answers it.
 */
import { createDb, type Db } from "@albusforge/db";
import { awaitEgress, buildTokensUsed, createMeter, createProvider, llmCallsInserter } from "@albusforge/llm";
import { buildApp } from "./app";
import { createCatalogueCache, dbPartsSource } from "./catalogue";
import { configFromEnv } from "./config";
import { type HandlerDeps, turnsHandler } from "./handler";
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
  // No pool-wide handle: every query a turn makes runs on the turn's own connection.
  const { pool } = createDb(config.db, {
    max: 5,
    connectTimeoutMs: connectMs,
    statementTimeoutMs: queryMs,
    queryTimeoutMs: readMs,
    idleTimeoutMs: idleMs,
  });
  pool.on("error", (error) => log("ERROR", "idle database client error", { error }));

  const catalogue = createCatalogueCache({
    source: dbPartsSource(),
    includeDrafts: config.registryIncludeDrafts,
    onLoad: (snapshot) =>
      log(snapshot.partCount === 0 ? "WARNING" : "INFO", "part catalogue loaded", {
        fields: { parts: snapshot.partCount, capabilities: snapshot.vocabulary.capabilities.size, includeDrafts: config.registryIncludeDrafts },
      }),
  });
  // Metering runs on the turn's own connection, never a second one from the
  // pool: see handler.ts on why a turn costs exactly one connection.
  const bindDb = (turnDb: Db) => ({
    catalogue: { get: () => catalogue.get(turnDb) },
    meter: createMeter({
      insert: llmCallsInserter(turnDb),
      onUnknownModel: (model) =>
        log("WARNING", "model missing from the price table; priced at the highest rate in every token category", { fields: { model } }),
    }),
    tokensUsed: (buildId: string) => buildTokensUsed(turnDb, buildId),
  });

  const deps: HandlerDeps = {
    pool,
    log,
    bindDb,
    deadlineMs: config.turnDeadlineMs,
    budgetMs: config.turnBudgetMs,
    turn: {
      provider,
      model: config.llm.model,
      effort: config.llm.effort,
      prompts,
      tokenCeiling: config.buildTokenCeiling,
      log,
    },
  };

  const app = buildApp({
    turns: turnsHandler(deps),
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
      turnBudgetMs: config.turnBudgetMs,
    },
  });

  /*
   * How long the route to the model API takes to open, measured, not waited
   * for. Blocking startup on this was tried and removed (packages/llm's
   * egress.ts): it cost every cold start its whole budget and prevented
   * nothing. A turn that arrives before the route opens is carried by the
   * retries instead — transport retries, the hand-back to gateway's retry,
   * and the portal's chase.
   *
   * Not awaited, so it can't hold up serving, and its own failure can't take
   * the instance down.
   */
  void awaitEgress().then(
    (egress) => {
      log(egress.ok ? "INFO" : "CRITICAL", egress.ok ? "route to the model API opened" : "route to the model API never opened", {
        fields: { attempts: egress.attempts, waitedMs: egress.waitedMs, ...(egress.lastCode === undefined ? {} : { lastCode: egress.lastCode }) },
      });
    },
    (error: unknown) => log("WARNING", "could not measure the route to the model API", { error }),
  );
}

void main();
