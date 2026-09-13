import { describe, expect, it } from "vitest";
import { INTAKE_TIMEOUT_MS } from "../../gateway/src/intake";
import { CALLER_ATTEMPT_BUDGET_MS, configFromEnv } from "./config";

const base = {
  DB_HOST: "localhost",
  DB_NAME: "albus",
  DB_USER: "albus_app",
  DB_PASSWORD: "db-secret",
  LLM_MODEL: "claude-opus-5",
  ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
};

describe("configFromEnv", () => {
  it("keeps the total budget inside the gateway deadline", () => {
    expect(CALLER_ATTEMPT_BUDGET_MS).toBe(INTAKE_TIMEOUT_MS);
    expect(configFromEnv(base).turnBudgetMs).toBe(48_000);
    expect(configFromEnv({ ...base, TURN_DEADLINE_MS: "46000" }).turnBudgetMs).toBe(49_000);
    expect(() => configFromEnv({ ...base, TURN_DEADLINE_MS: "46001" })).toThrow(/TURN_DEADLINE_MS/);
  });

  it("applies defaults", () => {
    const config = configFromEnv(base);
    expect(config).toMatchObject({
      port: 8080,
      llm: { provider: "anthropic", model: "claude-opus-5", effort: "medium" },
      registryIncludeDrafts: false,
      buildTokenCeiling: 300_000,
      turnDeadlineMs: 45_000,
      dbTimeouts: { connectMs: 5000, queryMs: 10_000, readMs: 11_000, idleMs: 30_000 },
    });
  });

  it("reads the staging settings", () => {
    const config = configFromEnv({ ...base, LLM_EFFORT: "low", REGISTRY_INCLUDE_DRAFTS: "true", LLM_BUILD_TOKEN_CEILING: "50000", PORT: "9000" });
    expect(config).toMatchObject({ port: 9000, llm: { effort: "low" }, registryIncludeDrafts: true, buildTokenCeiling: 50_000 });
  });

  it("requires LLM_MODEL and, for anthropic, the API key, without echoing secrets", () => {
    const messageOf = (env: Record<string, string | undefined>) => {
      try {
        configFromEnv(env);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error("expected configFromEnv to throw");
    };
    expect(messageOf({ ...base, LLM_MODEL: undefined })).toMatch(/LLM_MODEL/);
    expect(messageOf({ ...base, LLM_EFFORT: "extreme" })).toMatch(/LLM_EFFORT/);
    const missingKey = messageOf({ ...base, ANTHROPIC_API_KEY: "" });
    expect(missingKey).toMatch(/ANTHROPIC_API_KEY/);
    expect(missingKey).not.toContain("db-secret");
    expect(messageOf({ ...base, ANTHROPIC_API_KEY: "sk-ant-secret-value", LLM_MODEL: "" })).not.toContain("sk-ant-secret-value");
  });

  it("rejects a REGISTRY_INCLUDE_DRAFTS that isn't true or false", () => {
    expect(() => configFromEnv({ ...base, REGISTRY_INCLUDE_DRAFTS: "yes" })).toThrow(/REGISTRY_INCLUDE_DRAFTS/);
  });
});
