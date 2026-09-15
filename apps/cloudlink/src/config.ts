import { dbConfigFromEnv } from "@albusforge/db";
import { z } from "zod";

const Env = z.object({
  OBSERVATION_MAX_INFLIGHT: z.coerce.number().int().min(1).max(4).default(4),
  OBSERVATION_MAX_DAILY_COUNT: z.coerce.number().int().min(1).max(10000).default(1200),
  OBSERVATION_MAX_DAILY_BYTES: z.coerce.number().int().min(1).max(1073741824).default(134217728),
  OBSERVATION_MAX_ATTEMPTS_PER_MINUTE: z.coerce.number().int().min(1).max(60).default(6),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  K_SERVICE: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(10).default(5),
  INGEST_MAX_INFLIGHT: z.coerce.number().int().min(1).max(32).default(8),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).max(10000).default(5000),
  DB_QUERY_TIMEOUT_MS: z.coerce.number().int().min(1).max(10000).default(10000),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1).max(60000).default(30000),
});
export function configFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Env.safeParse(env);
  // Report names only; Zod issue messages can include literal input values.
  if (!parsed.success) throw new Error(`Invalid cloudlink configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  const e = parsed.data;
  const db = dbConfigFromEnv(env);
  if (e.K_SERVICE && db.ssl !== "require") throw new Error("Cloud Run requires DB_SSL=require");
  return {
    port: e.PORT, db,
    observations: { maxInflight: e.OBSERVATION_MAX_INFLIGHT, maxDailyCount: e.OBSERVATION_MAX_DAILY_COUNT,
      maxDailyBytes: e.OBSERVATION_MAX_DAILY_BYTES, maxAttemptsPerMinute: e.OBSERVATION_MAX_ATTEMPTS_PER_MINUTE },
    maxInflight: e.INGEST_MAX_INFLIGHT,
    poolOptions: { max: e.DB_POOL_MAX, connectionTimeoutMillis: e.DB_CONNECT_TIMEOUT_MS,
      statement_timeout: e.DB_QUERY_TIMEOUT_MS, query_timeout: e.DB_QUERY_TIMEOUT_MS + 1000,
      idleTimeoutMillis: e.DB_IDLE_TIMEOUT_MS },
  };
}
export type Config = ReturnType<typeof configFromEnv>;
