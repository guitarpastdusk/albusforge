import { createDb } from "./client.js";
import { dbConfigFromEnv } from "./config.js";
import { maintainTelemetryStorage, processTelemetryRollups } from "./telemetry-storage.js";

const task = process.argv[2];
if (!["rollup", "maintain"].includes(task ?? "")) throw new Error("Expected rollup or maintain");
const config = dbConfigFromEnv();
if (process.env.CLOUD_RUN_JOB && config.ssl !== "require") throw new Error("Cloud jobs require DB_SSL=require");
const { pool } = createDb(config, { max: 1, connectTimeoutMs: 5000, statementTimeoutMs: 300000, queryTimeoutMs: 301000 });
pool.on("error", () => console.error('{"severity":"ERROR","message":"telemetry job pool error"}'));
try {
  const result = task === "rollup" ? { processed: await processTelemetryRollups(pool, Number(process.env.TELEMETRY_ROLLUP_LIMIT ?? 64)) } : await maintainTelemetryStorage(pool);
  console.log(JSON.stringify({ severity: "INFO", task, ...result }));
} catch {
  console.error(JSON.stringify({ severity: "ERROR", task, message: "Telemetry job failed; safe to retry" }));
  process.exitCode = 1;
} finally { await pool.end(); }
