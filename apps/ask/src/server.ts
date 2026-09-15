import { createDb } from "@albusforge/db";
import { awaitEgress, createAnthropicProvider } from "@albusforge/llm";
import { configFromEnv } from "./config";
import { createStore } from "./store";
import { buildApp } from "./app";
async function main() {
  const config = configFromEnv();
  const {pool} = createDb(config.db,{max:config.DB_POOL_MAX,connectTimeoutMs:3000,statementTimeoutMs:5000,queryTimeoutMs:6000,idleTimeoutMs:30000});
  pool.on("error",() => { process.stderr.write("Ask idle database connection failed\n"); });
  const provider=config.ASK_MODEL_ENABLED === "true" ? createAnthropicProvider({apiKey:config.ANTHROPIC_API_KEY!,maxRetries:0,timeoutMs:config.ASK_DEADLINE_MS}) : undefined;
  const app = buildApp({ store:createStore(pool,{user:config.ASK_USER_DAILY_REQUESTS,tenant:config.ASK_TENANT_DAILY_REQUESTS,global:config.ASK_GLOBAL_DAILY_REQUESTS}),
    provider,
    model:config.LLM_MODEL,maxTokens:config.ASK_MAX_OUTPUT_TOKENS,concurrency:config.ASK_MAX_CONCURRENCY,deadlineMs:config.ASK_DEADLINE_MS,
    write:(line) => { process.stdout.write(line); },ping:async () => { await pool.query("SELECT 1 FROM telemetry.sensor_ask_requests LIMIT 0"); } });
  for (const sig of ["SIGTERM","SIGINT"] as const) process.once(sig,() => {
    const timer=setTimeout(() => process.exit(1),30000); timer.unref();
    void app.close().then(() => pool.end()).then(() => {clearTimeout(timer);process.exit(0);});
  });
  // A cold instance's route to the internet isn't usable for some seconds
  // after the port opens, so a question arriving in that window falls back to
  // evidence_only for no reason. Cloud Run holds the request while the
  // container starts; waiting here keeps the interpretation. Bounded, and
  // skipped entirely when no model is configured.
  if (provider) {
    const egress=await awaitEgress();
    process.stdout.write(JSON.stringify({event:"ask_egress",severity:egress.ok ? "INFO" : "CRITICAL",
      ok:egress.ok,attempts:egress.attempts,waited_ms:egress.waitedMs,last_code:egress.lastCode ?? null})+"\n");
  }
  await app.listen({host:"0.0.0.0",port:config.PORT});
}
main().catch(() => { process.stderr.write("Ask startup failed\n"); process.exitCode=1; });
