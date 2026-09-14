import { z } from "zod";
import { CapabilityStatus } from "./observations";

/** Read-only proof of cloud reception for an existing tenant-owned registration. */
export const DeviceSetupParams = z.strictObject({ id: z.uuid() });
export const DeviceSetupStatus = z.strictObject({
  device_id: z.uuid(),
  checked_at: z.iso.datetime({ offset: true }),
  registered_at: z.iso.datetime({ offset: true }),
  state: z.enum(["waiting_for_upload", "waiting_for_channels", "confirmed", "credential_revoked", "waiting_for_capabilities", "degraded"]),
  packet_received: z.boolean(),
  last_packet_at: z.iso.datetime({ offset: true }).nullable(),
  upload_interval_s: z.number().int().positive(),
  revoked_at: z.iso.datetime({ offset: true }).nullable(),
  capabilities: z.array(CapabilityStatus).max(64).optional(),
  channels: z.array(z.strictObject({
    key: z.string(), unit: z.string(),
    latest: z.strictObject({ at: z.iso.datetime({ offset: true }), value: z.number().finite() }).nullable(),
  })).max(64),
});
export type DeviceSetupStatus = z.infer<typeof DeviceSetupStatus>;
