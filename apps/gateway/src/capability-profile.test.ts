import { expect, it } from "vitest";
import { ProvisioningProfile } from "./provisioning-profile";
import { provisioningFixtureModel } from "./provisioning.test-fixtures";
it("refuses enrollment profiles whose numeric sources are all disabled", () => {
  const { profile } = provisioningFixtureModel();
  const channel = profile.channels[0]!;
  const input = { ...profile, capabilities: [{ id: "light", kind: "measurement", schema: "readings.v1", profile_id: "test-light", profile_version: 1,
    enabled: false, required: true, interval_s: 60, channels: { [channel.key]: channel.range } }],
    capability_sources: [{ capability_id: "light", part: channel.part, telemetry_schema: channel.telemetry_schema }] };
  expect(ProvisioningProfile.safeParse(input).success).toBe(false);
  input.capabilities[0]!.enabled = true;
  expect(ProvisioningProfile.safeParse(input).success).toBe(true);
});
