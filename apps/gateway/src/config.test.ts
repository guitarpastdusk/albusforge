import { describe, expect, it } from "vitest";
import { configFromEnv } from "./config";

const DB = { DB_HOST: "10.0.0.3", DB_NAME: "albus", DB_USER: "albus_app", DB_PASSWORD: "s3cret-value" };

describe("configFromEnv", () => {
  it("defaults PORT to 8080 and DB_SSL to require", () => {
    expect(configFromEnv(DB)).toEqual({
      port: 8080,
      db: { host: "10.0.0.3", port: 5432, database: "albus", user: "albus_app", password: "s3cret-value", ssl: "require" },
    });
  });

  it("reads PORT", () => {
    expect(configFromEnv({ ...DB, PORT: "9090" }).port).toBe(9090);
  });

  it("rejects a bad PORT", () => {
    expect(() => configFromEnv({ ...DB, PORT: "http" })).toThrow(/PORT/);
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
