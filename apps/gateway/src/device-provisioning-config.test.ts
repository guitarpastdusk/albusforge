import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { deviceProvisioningFromEnv } from "./device-provisioning-config";
const keys = () => JSON.stringify({ active: "test", keys: { test: randomBytes(32).toString("base64url") } });
it("ships disabled with no approved production profiles and requires paired secure configuration", () => {
  expect(deviceProvisioningFromEnv({})).toEqual({ keys: null, ingestUrl: null, profiles: [] });
  expect(() => deviceProvisioningFromEnv({ DEVICE_HANDOFF_KEYS: keys() })).toThrow("configured together");
  expect(() => deviceProvisioningFromEnv({ DEVICE_INGEST_URL: "https://ingest.example.test/ingest/v1" })).toThrow("configured together");
  expect(deviceProvisioningFromEnv({ DEVICE_HANDOFF_KEYS: keys(), DEVICE_INGEST_URL: "https://ingest.example.test/ingest/v1" }).profiles).toEqual([]);
});
it("rejects local-only profiles and plaintext ingestion on Cloud Run without exposing environment values", () => {
  const env = { K_SERVICE: "gateway", DEVICE_HANDOFF_KEYS: keys(), DEVICE_INGEST_URL: "https://ingest.example.test/ingest/v1" };
  expect(() => deviceProvisioningFromEnv({ ...env, DEVICE_PROVISIONING_TEST_PROFILES_FILE: "/private/fixture.json" })).toThrow("local-test only");
  expect(() => deviceProvisioningFromEnv({ ...env, DEVICE_INGEST_URL: "http://127.0.0.1/ingest/v1" })).toThrow("Invalid DEVICE_INGEST_URL");
  expect(() => deviceProvisioningFromEnv({ ...env, DEVICE_INGEST_URL: "https://secret:password@example.test/ingest/v1" })).toThrow(/^Invalid DEVICE_INGEST_URL; expected the standalone HTTPS ingestion endpoint$/);
});
