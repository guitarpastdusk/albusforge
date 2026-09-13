import { type DbConfig, dbConfigFromEnv } from "@albusforge/db";
import { z } from "zod";

export interface GatewayConfig {
  port: number;
  db: DbConfig;
}

const ServerEnv = z.object({
  // Cloud Run sets PORT.
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
});

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Throws on invalid config, naming the variables but never echoing a value.
 * The database variables are required even though /healthz needs none of
 * them: a gateway deployed without them should fail at startup, not at the
 * first request.
 */
export function configFromEnv(env: Env = process.env): GatewayConfig {
  const parsed = ServerEnv.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid gateway environment:\n${z.prettifyError(parsed.error)}`);
  return { port: parsed.data.PORT, db: dbConfigFromEnv(env) };
}
