import { TelemetrySeriesQuery } from "@albusforge/schema";
import { ApiRequestError } from "./api/core";

export const windows = {
  hour: { label: "Last hour", ms: 3600000 },
  day: { label: "Last 24 hours", ms: 86400000 },
  week: { label: "Last 7 days", ms: 604800000 },
  month: { label: "Last 30 days", ms: 2592000000 },
} as const;
export type Search = Record<string, string | string[] | undefined>;
/**
 * The window, resolution and end time are shared by every plot on the page; only
 * the channel differs. `forChannel` asks for one specific channel's query, which
 * is how the device page builds a series per channel from one chosen window.
 */
export function selection(search: Search, channels: string[], now: number, forChannel?: string) {
  const channel =
    forChannel ?? (typeof search.channel === "string" ? search.channel : channels[0]);
  const window =
    typeof search.window === "string" && Object.hasOwn(windows, search.window)
      ? (search.window as keyof typeof windows)
      : "hour";
  const resolution =
    typeof search.resolution === "string" ? search.resolution : "raw";
  const end =
    typeof search.end === "string" && search.end
      ? Date.parse(`${search.end}Z`)
      : now;
  const unit =
    resolution === "1h" ? 3600000 : resolution === "1m" ? 60000 : 1000;
  const to = Math.floor(end / unit) * unit;
  if (!Number.isFinite(to) || !channel || !channels.includes(channel))
    return {
      window,
      error: "Choose a provisioned channel and a valid UTC end time.",
    } as const;
  if (end > now)
    return {
      window,
      error:
        "End time cannot be in the future. Choose an earlier UTC time or leave it blank for now.",
    } as const;
  const parsed = TelemetrySeriesQuery.safeParse({
    channel,
    resolution,
    from: new Date(to - windows[window].ms).toISOString(),
    to: new Date(to).toISOString(),
    limit: 2000,
  });
  if (!parsed.success)
    return {
      window,
      error:
        "Choose raw for up to 24 hours, minute averages for up to 7 days, or hourly averages for longer windows.",
    } as const;
  return { query: parsed.data, window } as const;
}
export function historyFailure(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (error.status === 410) {
    const details = error.details as { available_from?: unknown } | undefined;
    const available =
      typeof details?.available_from === "string"
        ? Date.parse(details.available_from)
        : NaN;
    return `This history has expired. Choose a later end time or hourly averages.${Number.isFinite(available) ? ` Available from ${new Date(available).toISOString()}.` : ""}`;
  }
  if (error.status === 422)
    return "This request exceeds the history limits. Choose a shorter window or a coarser resolution. No partial series is shown.";
  if (error.status === 503)
    return "History is temporarily busy. Apply the filters again to retry.";
  return null;
}
