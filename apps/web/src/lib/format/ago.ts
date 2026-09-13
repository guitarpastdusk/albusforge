import { pluralize } from "./pluralize";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * - `short` — live readings: "now", "40s ago", "2m ago", "3h ago", "5d ago"
 * - `long` — project activity: "just now", "2 min ago", "yesterday", "last week"
 *
 * Times in the future (clock skew) count as now.
 */
export type AgoStyle = "short" | "long";

export function formatAgo(when: Date | string, now: Date = new Date(), style: AgoStyle = "short"): string {
  const ms = Math.max(0, now.getTime() - new Date(when).getTime());

  if (style === "short") {
    if (ms < 5 * SECOND) return "now";
    if (ms < MINUTE) return `${Math.floor(ms / SECOND)}s ago`;
    if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
    if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
    return `${Math.floor(ms / DAY)}d ago`;
  }

  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${pluralize(Math.floor(ms / HOUR), "hour")} ago`;

  const days = Math.floor(ms / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${pluralize(Math.floor(days / 30), "month")} ago`;
  return `${pluralize(Math.floor(days / 365), "year")} ago`;
}
