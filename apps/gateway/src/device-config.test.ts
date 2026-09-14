import { randomBytes, randomUUID } from "node:crypto";
import { DeviceConfigV1 } from "@albusforge/schema";
import { expect, it } from "vitest";
const fixture = () => ({ v: 1, device_id: randomUUID(), token: randomBytes(32).toString("base64url"), ingest_url: "https://ingest.example.test/ingest/v1", seq_start: 0, profile_id: "test-only", runtime: "0.1.0", channels: { illuminance: { unit: "lux", min: 0, max: 65535 } }, build_id: randomUUID(), plan_version: 1, code_version: 1, manifest_digest: "a".repeat(64) });
it("accepts the bounded installer contract and only canonical device tokens", () => {
  const config = fixture(); expect(DeviceConfigV1.parse(config)).toEqual(config);
  expect(DeviceConfigV1.safeParse({ ...config, token: `${config.token}=` }).success).toBe(false);
  expect(DeviceConfigV1.safeParse({ ...config, token: "A".repeat(42) + "B" }).success).toBe(false);
  expect(DeviceConfigV1.safeParse({ ...config, seq_start: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  expect(DeviceConfigV1.safeParse({ ...config, code_version: 0 }).success).toBe(false);
  expect(DeviceConfigV1.safeParse({ ...config, wifi_password: "never sent to server" }).success).toBe(false);
});
it("forbids userinfo, query secrets, fragments, unsupported paths and nonlocal plaintext ingestion", () => {
  for (const ingest_url of ["https://user:secret@example.test/ingest/v1", "https://example.test/ingest/v1?token=secret", "https://example.test/ingest/v1#x", "http://example.test/ingest/v1", "https://example.test/v1/ingest", "ftp://example.test/ingest/v1"]) expect(DeviceConfigV1.safeParse({ ...fixture(), ingest_url }).success).toBe(false);
  expect(DeviceConfigV1.safeParse({ ...fixture(), ingest_url: "http://127.0.0.1:18081/ingest/v1" }).success).toBe(true);
});
