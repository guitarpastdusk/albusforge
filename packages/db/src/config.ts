import type { ClientConfig } from "pg";
import { z } from "zod";

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /**
   * `require`: TLS on, no CA verification. Cloud SQL private IP enforces
   * ENCRYPTED_ONLY, and its server certificate isn't signed by a public CA.
   * `disable`: plain TCP, for local Postgres.
   */
  ssl: "require" | "disable";
}

export interface AppRole {
  name: string;
  password: string;
}

const DbEnv = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  // Defaults to TLS so a missing variable in the cloud fails safe.
  DB_SSL: z.enum(["require", "disable"]).default("require"),
});

type Env = Readonly<Record<string, string | undefined>>;

export function dbConfigFromEnv(env: Env = process.env): DbConfig {
  const parsed = DbEnv.safeParse(env);
  // The prettified error names variables and never echoes DB_PASSWORD.
  if (!parsed.success) throw new Error(`Invalid database environment:\n${z.prettifyError(parsed.error)}`);
  const e = parsed.data;
  return { host: e.DB_HOST, port: e.DB_PORT, database: e.DB_NAME, user: e.DB_USER, password: e.DB_PASSWORD, ssl: e.DB_SSL };
}

/** DB_APP_ROLE and DB_APP_PASSWORD come as a pair; either alone is a misconfiguration. */
export function appRoleFromEnv(env: Env = process.env): AppRole | undefined {
  const name = env.DB_APP_ROLE || undefined;
  const password = env.DB_APP_PASSWORD || undefined;
  if (!name && !password) return undefined;
  if (!name || !password) throw new Error("DB_APP_ROLE and DB_APP_PASSWORD must be set together");
  return { name, password };
}

export function pgConnectionConfig(config: DbConfig): ClientConfig {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl === "require" ? { rejectUnauthorized: false } : false,
  };
}
