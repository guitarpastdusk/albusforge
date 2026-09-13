import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getOptions: vi.fn(), connectorClose: vi.fn(), poolEnd: vi.fn(), pool: vi.fn() }));
vi.mock("@google-cloud/cloud-sql-connector", () => ({
  IpAddressTypes: { PRIVATE: "PRIVATE" },
  Connector: class { getOptions = mocks.getOptions; close = mocks.connectorClose; },
}));
vi.mock("pg", () => ({ default: { Pool: class { constructor(options: unknown) { mocks.pool(options); } end = mocks.poolEnd; } } }));
import { configFromEnv } from "./config.js";
import { connectDatabase } from "./database.js";
beforeEach(() => vi.clearAllMocks());
const config = configFromEnv({ K_SERVICE: "cloudlink", INSTANCE_CONNECTION_NAME: "p:r:i", DB_NAME: "db", DB_USER: "app", DB_PASSWORD: "secret" });
it("uses a private connector transport and closes it even when pool shutdown fails", async () => {
  mocks.getOptions.mockResolvedValueOnce({ stream: "connector-stream" });
  mocks.poolEnd.mockRejectedValueOnce(new Error("shutdown failure"));
  const db = await connectDatabase(config);
  expect(mocks.getOptions).toHaveBeenCalledWith({ instanceConnectionName: "p:r:i", ipType: "PRIVATE" });
  expect(mocks.pool).toHaveBeenCalledWith(expect.objectContaining({ stream: "connector-stream", max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 11000 }));
  await expect(db.close()).rejects.toThrow("shutdown failure");
  expect(mocks.connectorClose).toHaveBeenCalledTimes(1);
});
it("cleans up the connector after failed startup", async () => {
  mocks.getOptions.mockRejectedValueOnce(new Error("connection failure"));
  await expect(connectDatabase(config)).rejects.toThrow("connection failure");
  expect(mocks.connectorClose).toHaveBeenCalledTimes(1);
});
