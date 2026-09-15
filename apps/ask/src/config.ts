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
  /** Multi-turn device chat. Separate switch and model from the classifier above. */
  CHAT_ENABLED: z.enum(["true", "false"]).default("false"),
  CHAT_MODEL: z.literal("claude-sonnet-5").default("claude-sonnet-5"),
  CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(4096).default(1024),
  /** Model calls per question. Each may run several tools; a turn that keeps asking is stopped. */
  CHAT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(8).default(5),
  /** A tool loop makes several sequential model calls, so it cannot share the single-shot classifier's deadline. */
  CHAT_DEADLINE_MS: z.coerce.number().int().min(5000).max(55000).default(45000),
  /** A chat turn is several frontier calls, so its allowances are lower than the classifier's. */
  CHAT_USER_DAILY_REQUESTS: z.coerce.number().int().min(1).max(500).default(15),
  CHAT_TENANT_DAILY_REQUESTS: z.coerce.number().int().min(1).max(5000).default(60),
  CHAT_GLOBAL_DAILY_REQUESTS: z.coerce.number().int().min(1).max(20000).default(120),
  ASK_USER_DAILY_REQUESTS: z.coerce.number().int().min(1).max(1000).default(20),
  ASK_GLOBAL_DAILY_REQUESTS: z.coerce.number().int().min(1).max(10000).default(200),
  ASK_TENANT_DAILY_REQUESTS: z.coerce.number().int().min(1).max(10000).default(100),
}).refine((e) => e.ASK_MODEL_ENABLED === "false" || Boolean(e.LLM_MODEL && e.ANTHROPIC_API_KEY), { message: "Enabled model requires model and secret" })
  .refine((e) => e.CHAT_ENABLED === "false" || Boolean(e.ANTHROPIC_API_KEY), { message: "Enabled chat requires a secret" });
export function configFromEnv(env: Readonly<Record<string,string|undefined>> = process.env) {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new Error("Invalid Ask configuration");
  return { ...parsed.data, db: dbConfigFromEnv(env) };
}
export type Config = ReturnType<typeof configFromEnv>;
