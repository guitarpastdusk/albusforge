import { z } from "zod";
import { TelemetryChannel, TelemetryChannels, type PartDefinition } from "@albusforge/schema";

const Pin = z.strictObject({ id: z.string().min(1), version: z.string().min(1) });
/** Reviewed server configuration, never request input or inferred from a part's label. */
export const ProvisioningProfile = z.strictObject({
  id: z.string().min(1).max(100), version: z.string().min(1).max(40),
  assembly_profile: Pin,
  runtime: z.string().min(1).max(40),
  part_versions: z.array(Pin).min(1).max(64),
  firmware_profile_id: z.string().min(1).max(100),
  channels: z.array(z.strictObject({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    range: TelemetryChannel,
    part: Pin,
    telemetry_schema: z.string().min(1).max(100),
  })).min(1).max(64),
}).superRefine((profile, ctx) => {
  for (const [values, field] of [[profile.part_versions.map(p => `${p.id}@${p.version}`), "part_versions"], [profile.channels.map(c => c.key), "channels"]] as const) {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", path: [field], message: "Profile entries must be unique" });
  }
});
export type ProvisioningProfile = z.infer<typeof ProvisioningProfile>;
export const ProvisioningProfiles = z.array(ProvisioningProfile).max(64).superRefine((profiles, ctx) => {
  if (new Set(profiles.map(p => `${p.id}@${p.version}`)).size !== profiles.length) ctx.addIssue({ code: "custom", message: "Profile versions must be unique" });
});
const pins = (parts: ReadonlyArray<{ id: string; version: string }>) => parts.map(p => `${p.id}@${p.version}`).sort().join("|");

/** All supplying parts and telemetry schemas must match immutable accepted evidence exactly. */
export function resolveProvisioningProfile(profiles: readonly ProvisioningProfile[], accepted: {
  profile: { id: string; version: string }; runtime: string; part_versions: Array<{ id: string; version: string }>;
}, parts: readonly PartDefinition[], firmwareProfileId: string): { profile: ProvisioningProfile; channels: TelemetryChannels } | null {
  if (pins(parts) !== pins(accepted.part_versions) || parts.some(part => part.status !== "active")) return null;
  const matching = profiles.filter(profile => profile.assembly_profile.id === accepted.profile.id && profile.assembly_profile.version === accepted.profile.version
    && profile.runtime === accepted.runtime && pins(profile.part_versions) === pins(accepted.part_versions) && profile.firmware_profile_id === firmwareProfileId);
  // Ambiguous profiles require a reviewed selection, not first-match guessing.
  if (matching.length !== 1) return null;
  const profile = matching[0]!;
  const covered = new Set<string>();
  for (const channel of profile.channels) {
    const part = parts.find(part => part.id === channel.part.id && part.version === channel.part.version);
    if (!part || part.cloud.telemetry_schema !== channel.telemetry_schema) return null;
    covered.add(`${part.id}@${part.version}`);
  }
  if (parts.some(part => part.cloud.telemetry_schema !== null && !covered.has(`${part.id}@${part.version}`))) return null;
  const channels = TelemetryChannels.safeParse(Object.fromEntries(profile.channels.map(channel => [channel.key, channel.range])));
  return channels.success ? { profile, channels: channels.data } : null;
}
