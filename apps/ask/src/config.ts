import { dbConfigFromEnv } from "@albusforge/db";
import { z } from "zod";
const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(16).default(4),
  ASK_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  ASK_DEADLINE_MS: z.coerce.number().int().min(1000).max(25000).default(20000),
  ASK_MODEL_ENABLED: z.enum(["true", "false"]).default("false"),
  LLM_PROVIDER: z.literal("anthropic").default("anthropic"),
  LLM_MODEL: z.literal("claude-haiku-4-5").optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ASK_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(1024).default(512),
  ASK_USER_DAILY_REQUESTS: z.coerce.number().int().min(1).max(1000).default(20),
  ASK_GLOBAL_DAILY_REQUESTS: z.coerce.number().int().min(1).max(10000).default(200),
  ASK_TENANT_DAILY_REQUESTS: z.coerce.number().int().min(1).max(10000).default(100),
}).refine((e) => e.ASK_MODEL_ENABLED === "false" || Boolean(e.LLM_MODEL && e.ANTHROPIC_API_KEY), { message: "Enabled model requires model and secret" });
export function configFromEnv(env: Readonly<Record<string,string|undefined>> = process.env) {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new Error("Invalid Ask configuration");
  return { ...parsed.data, db: dbConfigFromEnv(env) };
}
export type Config = ReturnType<typeof configFromEnv>;
