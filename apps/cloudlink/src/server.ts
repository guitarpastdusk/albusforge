import { observationStorageFromEnv } from "@albusforge/storage";
import { buildApp } from "./app.js";
import { configFromEnv } from "./config.js";
import { connectDatabase } from "./database.js";

const log = (severity: string, message: string) => console.log(JSON.stringify({ severity, message }));
async function main() {
  const config = configFromEnv();
  const database = connectDatabase(config);
  database.pool.on("error", () => log("ERROR", "idle database connection failed"));
  const store = observationStorageFromEnv(process.env, "OBSERVATION_UPLOADS_ENABLED");
  const app = buildApp({ pool: database.pool, maxInflight: config.maxInflight,
    observations: store ? { store, maxInflight: config.observations.maxInflight, maxDailyCount: config.observations.maxDailyCount,
      maxDailyBytes: config.observations.maxDailyBytes, maxAttemptsPerMinute: config.observations.maxAttemptsPerMinute } : undefined });
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(1), 8000);
    timer.unref();
    try { await app.close(); await database.close(); }
    catch { process.exitCode = 1; log("ERROR", "cloudlink shutdown failed"); }
    finally { clearTimeout(timer); }
  }
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => void close());
  try { await app.listen({ host: "0.0.0.0", port: config.port }); log("INFO", "cloudlink listening"); }
  catch { await close(); throw new Error("listen failed"); }
}
process.on("unhandledRejection", () => { log("CRITICAL", "unhandled rejection"); process.exit(1); });
main().catch(() => { log("CRITICAL", "cloudlink startup failed"); process.exitCode = 1; });
