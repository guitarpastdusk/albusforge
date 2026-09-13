import { describe, expect, it } from "vitest";
import { configFromEnv } from "./config";

const DB = { DB_HOST: "10.0.0.3", DB_NAME: "albus", DB_USER: "albus_app", DB_PASSWORD: "s3cret-value" };

describe("configFromEnv", () => {
  it("defaults PORT to 8080, DB_SSL to require, and bounds every database wait", () => {
    expect(configFromEnv(DB)).toEqual({
      port: 8080,
      db: { host: "10.0.0.3", port: 5432, database: "albus", user: "albus_app", password: "s3cret-value", ssl: "require" },
      dbTimeouts: { connectMs: 5000, queryMs: 10_000, readMs: 11_000, idleMs: 30_000 },
      intake: { url: null, auth: "google" },
      registryIncludeDrafts: false,
      anonBuildsPerHour: 60,
    });
  });

  it("reads the intake URL, its auth mode, REGISTRY_INCLUDE_DRAFTS and ANON_BUILDS_PER_HOUR", () => {
    const config = configFromEnv({
      ...DB,
      INTAKE_URL: "https://intake-abc-uc.a.run.app",
      INTAKE_AUTH: "none",
      REGISTRY_INCLUDE_DRAFTS: "true",
      ANON_BUILDS_PER_HOUR: "250",
    });
    expect(config.intake).toEqual({ url: "https://intake-abc-uc.a.run.app", auth: "none" });
    expect(config.registryIncludeDrafts).toBe(true);
    expect(config.anonBuildsPerHour).toBe(250);
    expect(configFromEnv({ ...DB, INTAKE_URL: "" }).intake.url).toBeNull();
  });

  it.each([
    ["INTAKE_URL", "intake.internal"],
    ["INTAKE_AUTH", "basic"],
    ["REGISTRY_INCLUDE_DRAFTS", "yes"],
    ["ANON_BUILDS_PER_HOUR", "0"],
    ["ANON_BUILDS_PER_HOUR", "lots"],
  ])("rejects a bad %s", (name, value) => {
    expect(() => configFromEnv({ ...DB, [name]: value })).toThrow(new RegExp(name));
  });

  it("reads PORT and the timeouts", () => {
    const config = configFromEnv({ ...DB, PORT: "9090", DB_CONNECT_TIMEOUT_MS: "2000", DB_QUERY_TIMEOUT_MS: "3000", DB_IDLE_TIMEOUT_MS: "4000" });
    expect(config.port).toBe(9090);
    expect(config.dbTimeouts).toEqual({ connectMs: 2000, queryMs: 3000, readMs: 4000, idleMs: 4000 });
  });

  it.each([
    ["PORT", "http"],
    ["DB_CONNECT_TIMEOUT_MS", "0"],
    ["DB_QUERY_TIMEOUT_MS", "soon"],
  ])("rejects a bad %s", (name, value) => {
    expect(() => configFromEnv({ ...DB, [name]: value })).toThrow(new RegExp(name));
  });

  it("requires the database variables, without echoing the password", () => {
    const attempt = () => configFromEnv({ DB_PASSWORD: "s3cret-value" });
    expect(attempt).toThrow(/DB_HOST/);
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain("s3cret-value");
    }
  });
});
