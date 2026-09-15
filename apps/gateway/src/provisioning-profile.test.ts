import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PartDefinition } from "@albusforge/schema";
import { ProvisioningProfile, ProvisioningProfiles, resolveProvisioningProfile } from "./provisioning-profile";
// Synthetic approved evidence solely for resolver tests. The checked-in production list is empty.
function fixture() {
  const part = PartDefinition.parse(JSON.parse(readFileSync(new URL("../../../registry/parts/P-001/part.json", import.meta.url), "utf8")));
  part.status = "active";
  const pin = { id: part.id, version: part.version };
  const accepted = { profile: { id: "test-fixture", version: "1.0.0" }, runtime: "0.1.0", part_versions: [pin] };
  const profile = ProvisioningProfile.parse({ id: "test-only-temperature", version: "1.0.0", assembly_profile: accepted.profile, runtime: accepted.runtime, part_versions: [pin], firmware_profile_id: "test-only", health_sources: [], channels: [{ key: "temperature", range: { unit: "C", min: -40, max: 85 }, part: pin, telemetry_schema: part.cloud.telemetry_schema }] });
  return { part, accepted, profile };
}
it("requires exact active pins, profile/runtime and firmware target, with no production defaults", () => {
  // The shipped manifest is reviewed data, not a default: assert it parses and that
  // every entry pins an assembly profile, a firmware target and at least one source,
  // rather than asserting it is empty.
  const shipped = ProvisioningProfiles.parse(JSON.parse(readFileSync(new URL("../../../registry/provisioning-profiles.json", import.meta.url), "utf8")));
  for (const entry of shipped) {
    expect(entry.assembly_profile.id.length).toBeGreaterThan(0);
    expect(entry.firmware_profile_id.length).toBeGreaterThan(0);
    expect(entry.channels.length + (entry.capabilities?.length ?? 0)).toBeGreaterThan(0);
  }
  const { part, accepted, profile } = fixture();
  expect(resolveProvisioningProfile([profile], accepted, [part], "test-only")?.channels).toEqual({ temperature: { unit: "C", min: -40, max: 85 } });
  expect(resolveProvisioningProfile([], accepted, [part], "test-only")).toBeNull();
  expect(resolveProvisioningProfile([profile], accepted, [{ ...part, status: "draft" }], "test-only")).toBeNull();
  expect(resolveProvisioningProfile([profile], { ...accepted, runtime: "1.0.0" }, [part], "test-only")).toBeNull();
  expect(resolveProvisioningProfile([profile], { ...accepted, profile: { ...accepted.profile, version: "2.0.0" } }, [part], "test-only")).toBeNull();
  expect(resolveProvisioningProfile([profile], accepted, [{ ...part, version: "2.0.0" }], "test-only")).toBeNull();
  expect(resolveProvisioningProfile([profile], accepted, [part], "unknown-firmware")).toBeNull();
});
it("refuses ambiguous profiles, incorrect telemetry schemas and unowned channel declarations", () => {
  const { part, accepted, profile } = fixture();
  expect(resolveProvisioningProfile([profile, { ...profile, id: "other" }], accepted, [part], "test-only")).toBeNull();
  expect(resolveProvisioningProfile([{ ...profile, channels: [{ ...profile.channels[0]!, telemetry_schema: "invented.v1" }] }], accepted, [part], "test-only")).toBeNull();
  expect(resolveProvisioningProfile([{ ...profile, channels: [{ ...profile.channels[0]!, part: { id: "different", version: "1.0.0" } }] }], accepted, [part], "test-only")).toBeNull();
  expect(ProvisioningProfile.safeParse({ ...profile, channels: [...profile.channels, ...profile.channels] }).success).toBe(false);
  expect(ProvisioningProfile.safeParse({ ...profile, channels: [{ ...profile.channels[0]!, range: { unit: "C", min: 20, max: 10 } }] }).success).toBe(false);
});

it("accounts explicitly for host packet health without inventing a sensor channel", () => {
  const { part, accepted, profile } = fixture();
  const host = PartDefinition.parse(JSON.parse(readFileSync(new URL("../../../registry/parts/C-001/part.json", import.meta.url), "utf8")));
  host.status = "active";
  const hostPin = { id: host.id, version: host.version };
  const plan = { ...accepted, part_versions: [...accepted.part_versions, hostPin] };
  const withHost = { ...profile, part_versions: plan.part_versions };
  expect(resolveProvisioningProfile([withHost], plan, [part, host], "test-only")).toBeNull();
  const withHealth = { ...withHost, health_sources: [{ part: hostPin, telemetry_schema: "device_health.v1" as const }] };
  expect(resolveProvisioningProfile([withHealth], plan, [part, host], "test-only")?.channels).toEqual({ temperature: { unit: "C", min: -40, max: 85 } });
  expect(resolveProvisioningProfile([{ ...withHealth, health_sources: [{ part: { id: part.id, version: part.version }, telemetry_schema: "device_health.v1" }] }], plan, [part, host], "test-only")).toBeNull();
});
