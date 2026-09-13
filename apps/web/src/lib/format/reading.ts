import { formatAgo } from "./ago";

export const AWAITING_FIRST_READING = "Awaiting first reading";

/** A provisioned device that has never reported is awaiting — not online, not offline. */
export type DeviceState = "awaiting" | "online" | "offline";

interface DeviceReadingStatus {
  online: boolean;
  last_reading_at: string | null;
}

export function deviceState({ online, last_reading_at }: DeviceReadingStatus): DeviceState {
  if (last_reading_at === null) return "awaiting";
  return online ? "online" : "offline";
}

/** "40s ago", or "Awaiting first reading" when there has never been one. */
export function formatReadingAge(lastReadingAt: Date | string | null, now: Date = new Date()): string {
  return lastReadingAt === null ? AWAITING_FIRST_READING : formatAgo(lastReadingAt, now);
}

/** Dashboard header: "Online · last reading 40s ago", "Offline · last reading 3h ago", or "Awaiting first reading". */
export function formatDeviceStatus(device: DeviceReadingStatus, now: Date = new Date()): string {
  if (device.last_reading_at === null) return AWAITING_FIRST_READING;
  return `${device.online ? "Online" : "Offline"} · last reading ${formatAgo(device.last_reading_at, now)}`;
}
