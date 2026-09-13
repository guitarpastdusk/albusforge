import { createDb } from "./client.js";
import { dbConfigFromEnv } from "./config.js";
import { maintainTelemetryStorage, processTelemetryRollups } from "./telemetry-storage.js";
import { readTelemetryHealth } from "./telemetry-health.js";

const task = process.argv[2];
if (!["rollup", "maintain"].includes(task ?? "")) throw new Error("Expected rollup or maintain");
const config = dbConfigFromEnv();
if (process.env.CLOUD_RUN_JOB && config.ssl !== "require") throw new Error("Cloud jobs require DB_SSL=require");
let workerPoolClosed = false;
const { pool } = createDb(config, { max: 1, connectTimeoutMs: 5000, statementTimeoutMs: 300000, queryTimeoutMs: 301000 });
pool.on("error", () => console.error('{"severity":"ERROR","message":"telemetry job pool error"}'));
try {
  const result = task === "rollup" ? { processed: await processTelemetryRollups(pool, Number(process.env.TELEMETRY_ROLLUP_LIMIT ?? 64)) } : await maintainTelemetryStorage(pool);
  console.log(JSON.stringify({ severity: "INFO", task, ...result }));
  // Close the worker lease before bounded health scans: peak connection budget stays one.
  await pool.end();
  workerPoolClosed = true;
  const health = createDb(config, { max: 1, connectTimeoutMs: 5000, statementTimeoutMs: 5000, queryTimeoutMs: 6000 });
  health.pool.on("error", () => console.error('{"severity":"ERROR","message":"telemetry health pool error"}'));
  try {
    console.log(JSON.stringify({ severity: "INFO", event: "telemetry_health", task, ...await readTelemetryHealth(health.pool) }));
  } finally { await health.pool.end(); }
} catch {
  console.error(JSON.stringify({ severity: "ERROR", task, message: "Telemetry job failed; safe to retry" }));
  process.exitCode = 1;
} finally { if (!workerPoolClosed) await pool.end(); }
