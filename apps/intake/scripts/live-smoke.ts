/*
 * Live smoke: one ask end to end against the real model and a local database.
 * Never run in CI; it spends money. Not imported by anything.
 *
 *   docker compose up -d postgres   # then migrate and load the registry (see README)
 *   DB_HOST=localhost DB_NAME=albus DB_USER=albus_app DB_PASSWORD=albus_app DB_SSL=disable \
 *   ANTHROPIC_API_KEY=... LLM_MODEL=claude-opus-5 \
 *     pnpm --filter intake smoke:live -- --answer "Battery, a few months" --record test/fixtures/recorded
 *
 * Options:
 *   --ask TEXT      the first message (default: the fridge monitor golden ask)
 *   --answer TEXT   a second message, sent if the first turn asked a question
 *   --record DIR    write each model response as <DIR>/<n>.json (responses only:
 *                   no request, no headers, nothing that carries the key)
 *
 * Prints replies, specs, and each call's tokens and cost. Never prints the key.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildMessages, builds, createDb, dbConfigFromEnv, llmCalls, specs } from "@albusforge/db";
import { buildTokensUsed, createMeter, createProvider, llmCallsInserter } from "@albusforge/llm";
import { recordingProvider } from "@albusforge/llm/testing";
import { asc, desc, eq } from "drizzle-orm";
import { GOLDEN_ASKS } from "../test/fixtures";
import { createCatalogueCache, dbPartsSource } from "../src/catalogue";
import { type HandlerDeps, handleTurn } from "../src/handler";
import { createLogger } from "../src/log";
import { loadPrompts } from "../src/prompts";

async function main() {
  if (process.env.CI) throw new Error("live-smoke calls the real API and never runs in CI");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const { values } = parseArgs({
    options: { ask: { type: "string" }, answer: { type: "string" }, record: { type: "string" } },
  });
  const ask = values.ask ?? GOLDEN_ASKS["fridge-monitor"].ask;
  const model = process.env.LLM_MODEL ?? "claude-opus-5";
  const effort = (process.env.LLM_EFFORT ?? "medium") as HandlerDeps["turn"]["effort"];

  let recorded = 0;
  const recordDir = values.record ? path.resolve(values.record) : undefined;
  if (recordDir) mkdirSync(recordDir, { recursive: true });
  const provider = recordingProvider(createProvider("anthropic", { apiKey }), (_request, response) => {
    recorded++;
    if (recordDir) writeFileSync(path.join(recordDir, `${recorded}.json`), `${JSON.stringify(response, null, 2)}\n`);
  });

  const { db, pool } = createDb(dbConfigFromEnv(), { max: 3, statementTimeoutMs: 10_000 });
  const log = createLogger();
  const deps: HandlerDeps = {
    db,
    pool,
    log,
    deadlineMs: 45_000,
    turn: {
      provider,
      model,
      effort,
      meter: createMeter({ insert: llmCallsInserter(db) }),
      catalogue: createCatalogueCache({ source: dbPartsSource(db), includeDrafts: true }),
      prompts: loadPrompts(),
      tokenCeiling: 300_000,
      tokensUsed: (id) => buildTokensUsed(db, id),
      log,
    },
  };

  try {
    const [build] = await db.insert(builds).values({ askText: ask, anonOwnerHash: "live-smoke" }).returning({ id: builds.id });
    const buildId = build!.id;
    console.log(`build ${buildId}, model ${model}, effort ${effort}`);

    const turn = async (text: string) => {
      await db.insert(buildMessages).values({ buildId, role: "user", text });
      const started = Date.now();
      const result = await handleTurn(deps, buildId);
      const [reply] = await db
        .select({ text: buildMessages.text })
        .from(buildMessages)
        .where(eq(buildMessages.buildId, buildId))
        .orderBy(desc(buildMessages.createdAt))
        .limit(1);
      const [spec] = await db.select().from(specs).where(eq(specs.buildId, buildId)).orderBy(desc(specs.version)).limit(1);
      console.log(`\n> ${text}\n< ${reply?.text}\n  result ${JSON.stringify(result)} in ${Date.now() - started} ms`);
      if (spec) console.log(`  spec v${spec.version}: ${JSON.stringify(spec.data)}`);
      return result;
    };

    const first = await turn(ask);
    if (values.answer && first && "status" in first && first.status === "asking") await turn(values.answer);

    const calls = await db.select().from(llmCalls).where(eq(llmCalls.buildId, buildId)).orderBy(asc(llmCalls.createdAt));
    console.log("\ncalls:");
    for (const c of calls) {
      console.log(
        `  ${c.model} stop=${c.stopReason} in=${c.inputTokens} out=${c.outputTokens} cache_read=${c.cacheReadInputTokens} cache_write=${c.cacheCreationInputTokens} cost=$${c.costUsd}`,
      );
    }
    const total = calls.reduce((sum, c) => sum + Number(c.costUsd), 0);
    console.log(`total $${total.toFixed(6)} over ${calls.length} call(s)${recordDir ? `; ${recorded} response(s) in ${recordDir}` : ""}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
