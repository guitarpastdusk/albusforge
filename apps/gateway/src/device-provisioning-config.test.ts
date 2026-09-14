import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import approvedProfiles from "../../../registry/provisioning-profiles.json";
import { deviceProvisioningFromEnv } from "./device-provisioning-config";
import { ProvisioningProfiles } from "./provisioning-profile";
const keys = () => JSON.stringify({ active: "test", keys: { test: randomBytes(32).toString("base64url") } });
const APPROVED = ProvisioningProfiles.parse(approvedProfiles);
it("ships approved production profiles that stay inert without paired secure configuration", () => {
  // Approved profiles now exist and are compiled in, so the manifest is no longer empty.
  expect(APPROVED.length).toBeGreaterThan(0);
  // Provisioning is still switched off: no handoff key and no ingest URL, which is exactly
  // what createDeviceProvisioningStore's configured() refuses with a 503
  // PROVISIONING_UNAVAILABLE. Having profiles must never on its own enable issuance.
  expect(deviceProvisioningFromEnv({})).toEqual({ keys: null, ingestUrl: null, profiles: APPROVED });
  // Both secrets, or neither. Half-configured is refused rather than silently degraded.
  expect(() => deviceProvisioningFromEnv({ DEVICE_HANDOFF_KEYS: keys() })).toThrow("configured together");
  expect(() => deviceProvisioningFromEnv({ DEVICE_INGEST_URL: "https://ingest.example.test/ingest/v1" })).toThrow("configured together");
  const enabled = deviceProvisioningFromEnv({ DEVICE_HANDOFF_KEYS: keys(), DEVICE_INGEST_URL: "https://ingest.example.test/ingest/v1" });
  expect(enabled.keys).not.toBeNull();
  expect(enabled.ingestUrl).toBe("https://ingest.example.test/ingest/v1");
  // The environment never adds or edits profiles: the manifest is the same reviewed data.
  expect(enabled.profiles).toEqual(APPROVED);
});
it("rejects local-only profiles and plaintext ingestion on Cloud Run without exposing environment values", () => {
  const env = { K_SERVICE: "gateway", DEVICE_HANDOFF_KEYS: keys(), DEVICE_INGEST_URL: "https://ingest.example.test/ingest/v1" };
  expect(() => deviceProvisioningFromEnv({ ...env, DEVICE_PROVISIONING_TEST_PROFILES_FILE: "/private/fixture.json" })).toThrow("local-test only");
  expect(() => deviceProvisioningFromEnv({ ...env, DEVICE_INGEST_URL: "http://127.0.0.1/ingest/v1" })).toThrow("Invalid DEVICE_INGEST_URL");
  expect(() => deviceProvisioningFromEnv({ ...env, DEVICE_INGEST_URL: "https://secret:password@example.test/ingest/v1" })).toThrow(/^Invalid DEVICE_INGEST_URL; expected the standalone HTTPS ingestion endpoint$/);
});
