import { dbConfigFromEnv } from "@albusforge/db";
import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  INSTANCE_CONNECTION_NAME: z.string().regex(/^[^:]+:[^:]+:[^:]+$/).optional(),
  K_SERVICE: z.string().optional(),
  DB_NAME: z.string().min(1), DB_USER: z.string().min(1), DB_PASSWORD: z.string(),
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
  if (e.K_SERVICE && !e.INSTANCE_CONNECTION_NAME) throw new Error("Cloud Run requires INSTANCE_CONNECTION_NAME");
  return {
    port: e.PORT, instance: e.INSTANCE_CONNECTION_NAME,
    local: e.INSTANCE_CONNECTION_NAME ? undefined : dbConfigFromEnv(env),
    user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME,
    maxInflight: e.INGEST_MAX_INFLIGHT,
    poolOptions: { max: e.DB_POOL_MAX, connectionTimeoutMillis: e.DB_CONNECT_TIMEOUT_MS,
      statement_timeout: e.DB_QUERY_TIMEOUT_MS, query_timeout: e.DB_QUERY_TIMEOUT_MS + 1000,
      idleTimeoutMillis: e.DB_IDLE_TIMEOUT_MS },
  };
}
export type Config = ReturnType<typeof configFromEnv>;
