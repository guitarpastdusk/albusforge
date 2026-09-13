import type { DeviceStatus } from "@albusforge/schema";
import { formatAgo } from "./ago";

export const AWAITING_FIRST_READING = "Awaiting first reading";

interface DeviceReadingStatus {
  status: DeviceStatus;
  last_reading_at: string | null;
}

/** `never_seen`, or no timestamp whatever the status says. */
export function isAwaitingFirstReading({ status, last_reading_at }: DeviceReadingStatus): boolean {
  return status === "never_seen" || last_reading_at === null;
}

/** "Online · last reading 40s ago", "Offline · last reading 3h ago", or "Awaiting first reading". */
export function formatDeviceStatus({ status, last_reading_at }: DeviceReadingStatus, now: Date = new Date()): string {
  if (status === "never_seen" || last_reading_at === null) return AWAITING_FIRST_READING;
  return `${status === "online" ? "Online" : "Offline"} · last reading ${formatAgo(last_reading_at, now)}`;
}
