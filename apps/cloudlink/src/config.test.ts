import { expect, it } from "vitest";
import { configFromEnv } from "./config.js";
const local = { DB_HOST: "localhost", DB_NAME: "albus", DB_USER: "app", DB_PASSWORD: "private-value", DB_SSL: "disable" };
it("bounds the pool and admission independently of the hosting provider", () => {
  const c = configFromEnv(local);
  expect(c.poolOptions.max).toBe(5); expect(c.maxInflight).toBe(8); expect(c.port).toBe(8080);
  expect(c.db.host).toBe("localhost");
  expect(() => configFromEnv({ ...local, DB_POOL_MAX: "11" })).toThrow("DB_POOL_MAX");
  expect(() => configFromEnv({ ...local, INGEST_MAX_INFLIGHT: "0" })).toThrow("INGEST_MAX_INFLIGHT");
});
it("requires DB_HOST and TLS in Cloud Run without a connector setting", () => {
  expect(() => configFromEnv({ ...local, K_SERVICE: "cloudlink" })).toThrow("DB_SSL=require");
  const c = configFromEnv({ DB_HOST: "10.0.0.3", DB_NAME: "albus", DB_USER: "app", DB_PASSWORD: "private-value", K_SERVICE: "cloudlink" });
  expect(c.db.host).toBe("10.0.0.3"); expect(c.db.ssl).toBe("require"); expect(c.db.port).toBe(5432);
  expect(() => configFromEnv({ ...local, DB_HOST: undefined })).toThrow("DB_HOST");
  try { configFromEnv({ ...local, DB_HOST: undefined }); } catch (e) { expect(String(e)).not.toContain("private-value"); }
});
it("bounds observation admission and quotas independently while preserving defaults",()=>{
  expect(configFromEnv(local).observations).toEqual({maxInflight:4,maxDailyCount:1200,maxDailyBytes:134217728,maxAttemptsPerMinute:6});
  for(const [name,value] of Object.entries({OBSERVATION_MAX_INFLIGHT:'5',OBSERVATION_MAX_DAILY_COUNT:'0',OBSERVATION_MAX_DAILY_BYTES:'0',OBSERVATION_MAX_ATTEMPTS_PER_MINUTE:'0'})){
    expect(()=>configFromEnv({...local,[name]:value})).toThrow(name);
  }
});
