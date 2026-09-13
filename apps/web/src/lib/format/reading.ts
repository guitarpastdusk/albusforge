import type { Channel, DeviceStatus } from "@albusforge/schema";
import { formatAgo } from "./ago";
import { pluralize } from "./pluralize";

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

export interface ReadingParts {
  value: string;
  /** Empty when the value carries its own meaning ("PASS", "34 days"). */
  unit: string;
}

/**
 * A reading shaped for display, from the channel's telemetry schema:
 * numbers at their display precision with a true minus sign, durations in
 * days, statuses verbatim.
 */
export function formatChannelValue(
  channel: Pick<Channel, "kind" | "precision" | "unit"> | undefined,
  value: number | string,
): ReadingParts {
  if (typeof value === "string" || !channel || channel.kind === "status") return { value: String(value), unit: "" };
  if (channel.kind === "duration") return { value: pluralize(Math.floor(value / 86_400), "day"), unit: "" };
  return { value: value.toFixed(channel.precision).replace("-", "−"), unit: channel.unit };
}

/** "87%", "−61 dBm", "PASS": a bare "%" sits against the number; any other unit gets a space. */
export function joinReading({ value, unit }: ReadingParts): string {
  if (unit === "") return value;
  return unit === "%" ? `${value}%` : `${value} ${unit}`;
}
