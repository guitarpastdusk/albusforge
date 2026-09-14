import { createDb, dbConfigFromEnv } from "@albusforge/db";
import { GcsObservationStorage } from "@albusforge/storage";
import { maintainObservations } from "./maintain.js";

async function main() {
  const config = dbConfigFromEnv();
  if (process.env.CLOUD_RUN_JOB && config.ssl !== "require") throw new Error("Cloud jobs require DB_SSL=require");
  const bucket = process.env.OBSERVATION_BUCKET;
  if (!bucket) throw new Error("OBSERVATION_BUCKET required");
  const { pool } = createDb(config, { max: 1, connectTimeoutMs: 5000, statementTimeoutMs: 5000, queryTimeoutMs: 6000 });
  pool.on("error", () => console.error('{"severity":"ERROR","message":"observation maintenance pool error"}'));
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGTERM", abort); process.once("SIGINT", abort);
  try {
    const result = await maintainObservations(pool, new GcsObservationStorage({ bucket }), {
      limit: Number(process.env.OBSERVATION_MAINTENANCE_LIMIT ?? 100),
      orphanGraceMs: Number(process.env.OBSERVATION_ORPHAN_GRACE_S ?? 120) * 1000,
      maxDailyCount: Number(process.env.OBSERVATION_MAX_DAILY_COUNT ?? 1200),
      maxDailyBytes: Number(process.env.OBSERVATION_MAX_DAILY_BYTES ?? 134217728),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240_000)]),
    });
    console.log(JSON.stringify({ severity: result.errors ? "WARNING" : "INFO", event: "observation_maintenance", ...result }));
    if (result.errors) process.exitCode = 1;
  } finally { process.off("SIGTERM", abort); process.off("SIGINT", abort); await pool.end(); }
}
main().catch(() => { console.error('{"severity":"ERROR","message":"Observation maintenance failed; safe to retry"}'); process.exitCode = 1; });
