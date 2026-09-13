import { expect, it } from "vitest";
import { configFromEnv } from "./config.js";
const local = { DB_HOST: "localhost", DB_NAME: "albus", DB_USER: "app", DB_PASSWORD: "private-value", DB_SSL: "disable" };
it("bounds the pool and admission independently of the hosting provider", () => {
  const c = configFromEnv(local);
  expect(c.poolOptions.max).toBe(5); expect(c.maxInflight).toBe(8); expect(c.port).toBe(8080);
  expect(c.instance).toBeUndefined(); expect(c.local?.host).toBe("localhost");
  expect(() => configFromEnv({ ...local, DB_POOL_MAX: "11" })).toThrow("DB_POOL_MAX");
  expect(() => configFromEnv({ ...local, INGEST_MAX_INFLIGHT: "0" })).toThrow("INGEST_MAX_INFLIGHT");
});
it("requires the connector in Cloud Run and does not require a plaintext DB host", () => {
  expect(() => configFromEnv({ ...local, K_SERVICE: "cloudlink" })).toThrow("INSTANCE_CONNECTION_NAME");
  const c = configFromEnv({ DB_NAME: "albus", DB_USER: "app", DB_PASSWORD: "private-value", K_SERVICE: "cloudlink", INSTANCE_CONNECTION_NAME: "project:region:instance" });
  expect(c.instance).toBe("project:region:instance"); expect(c.local).toBeUndefined();
  expect(() => configFromEnv({ ...local, INSTANCE_CONNECTION_NAME: "private-value" })).toThrow("INSTANCE_CONNECTION_NAME");
  try { configFromEnv({ ...local, INSTANCE_CONNECTION_NAME: "private-value" }); } catch (e) { expect(String(e)).not.toContain("private-value"); }
});
