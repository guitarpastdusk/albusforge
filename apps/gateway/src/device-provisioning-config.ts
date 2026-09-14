import { readFileSync, statSync } from "node:fs";
import { DeviceConfigV1 } from "@albusforge/schema";
import approvedProfiles from "../../../registry/provisioning-profiles.json";
import { parseHandoffKeys } from "./device-credential";
import { ProvisioningProfiles } from "./provisioning-profile";
import type { DeviceProvisioningOptions } from "./device-provisioning-store";

export function deviceProvisioningFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): DeviceProvisioningOptions {
  const keys = parseHandoffKeys(env.DEVICE_HANDOFF_KEYS);
  let ingestUrl: string | null = null;
  if (env.DEVICE_INGEST_URL) {
    const parsed = DeviceConfigV1.shape.ingest_url.safeParse(env.DEVICE_INGEST_URL);
    if (!parsed.success || (env.K_SERVICE && !env.DEVICE_INGEST_URL.startsWith("https://"))) throw new Error("Invalid DEVICE_INGEST_URL; expected the standalone HTTPS ingestion endpoint");
    ingestUrl = parsed.data;
  }
  if (!!keys !== !!ingestUrl) throw new Error("DEVICE_HANDOFF_KEYS and DEVICE_INGEST_URL must be configured together");
  let profiles: unknown = approvedProfiles;
  // Explicit local acceptance fixtures, never a production profile activation mechanism.
  if (env.DEVICE_PROVISIONING_TEST_PROFILES_FILE) {
    if (env.K_SERVICE) throw new Error("DEVICE_PROVISIONING_TEST_PROFILES_FILE is local-test only");
    try {
      if (statSync(env.DEVICE_PROVISIONING_TEST_PROFILES_FILE).size > 1024 * 1024) throw new Error();
      profiles = JSON.parse(readFileSync(env.DEVICE_PROVISIONING_TEST_PROFILES_FILE, "utf8"));
    } catch { throw new Error("Invalid local device provisioning profile fixture"); }
  }
  const parsed = ProvisioningProfiles.safeParse(profiles);
  if (!parsed.success) throw new Error("Invalid device provisioning profile manifest");
  return { keys, ingestUrl, profiles: parsed.data };
}
