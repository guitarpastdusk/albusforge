import { describe, expect, it } from "vitest";
import {
  AWAITING_FIRST_READING,
  formatChannelValue,
  formatWhen,
  joinReading,
  formatAgo,
  formatBytes,
  formatCompact,
  formatDeviceStatus,
  isAwaitingFirstReading,
  pluralize,
} from "./index";

const NOW = new Date("2026-09-13T12:00:00Z");
const before = (ms: number) => new Date(NOW.getTime() - ms);
const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe("pluralize", () => {
  it("uses the singular for exactly one", () => {
    expect(pluralize(1, "device")).toBe("1 device");
  });

  it("uses the plural otherwise, including zero", () => {
    expect(pluralize(0, "device")).toBe("0 devices");
    expect(pluralize(4, "device")).toBe("4 devices");
  });

  it("takes an irregular plural", () => {
    expect(pluralize(2, "battery", "batteries")).toBe("2 batteries");
  });
});

describe("formatAgo — short", () => {
  it.each([
    [0, "now"],
    [4 * S, "now"],
    [40 * S, "40s ago"],
    [2 * M, "2m ago"],
    [3 * H, "3h ago"],
    [5 * D, "5d ago"],
  ])("%d ms → %s", (ms, expected) => {
    expect(formatAgo(before(ms), NOW)).toBe(expected);
  });

  it("treats future timestamps as now", () => {
    expect(formatAgo(new Date(NOW.getTime() + 10 * S), NOW)).toBe("now");
  });

  it("accepts ISO strings", () => {
    expect(formatAgo("2026-09-13T11:59:20Z", NOW)).toBe("40s ago");
  });
});

describe("formatAgo — long", () => {
  it.each([
    [30 * S, "just now"],
    [2 * M, "2 min ago"],
    [1 * H, "1 hour ago"],
    [5 * H, "5 hours ago"],
    [26 * H, "yesterday"],
    [3 * D, "3 days ago"],
    [8 * D, "last week"],
    [21 * D, "3 weeks ago"],
    [45 * D, "1 month ago"],
    [800 * D, "2 years ago"],
  ])("%d ms → %s", (ms, expected) => {
    expect(formatAgo(before(ms), NOW, "long")).toBe(expected);
  });
});

describe("formatCompact", () => {
  it("abbreviates thousands in lower case", () => {
    expect(formatCompact(2400)).toBe("2.4k");
  });

  it("leaves small numbers alone", () => {
    expect(formatCompact(7)).toBe("7");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1_000, "1 KB"],
    [48_300_000, "48.3 MB"],
    [2_500_000_000_000_000, "2500 TB"],
  ])("%d → %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("device status for a device that may never have reported", () => {
  const at = new Date(NOW.getTime() - 40 * S).toISOString();

  it("formats never_seen with a null timestamp as awaiting, with no age", () => {
    const device = { status: "never_seen", last_reading_at: null } as const;
    expect(isAwaitingFirstReading(device)).toBe(true);
    expect(formatDeviceStatus(device, NOW)).toBe(AWAITING_FIRST_READING);
    expect(AWAITING_FIRST_READING).toBe("Awaiting first reading");
  });

  it("treats a null timestamp as awaiting even if status disagrees", () => {
    expect(isAwaitingFirstReading({ status: "online", last_reading_at: null })).toBe(true);
    expect(formatDeviceStatus({ status: "online", last_reading_at: null }, NOW)).toBe("Awaiting first reading");
  });

  it("treats never_seen as awaiting even with a stray timestamp", () => {
    expect(formatDeviceStatus({ status: "never_seen", last_reading_at: at }, NOW)).toBe("Awaiting first reading");
  });

  it("reports online and offline with the age of the last reading", () => {
    expect(formatDeviceStatus({ status: "online", last_reading_at: at }, NOW)).toBe("Online · last reading 40s ago");
    expect(formatDeviceStatus({ status: "offline", last_reading_at: at }, NOW)).toBe("Offline · last reading 40s ago");
    expect(isAwaitingFirstReading({ status: "offline", last_reading_at: at })).toBe(false);
  });
});

describe("formatChannelValue and joinReading", () => {
  const number = (unit: string, precision = 0) => ({ kind: "number" as const, precision, unit });

  it("formats numbers at the channel's precision", () => {
    expect(formatChannelValue(number("% VWC", 1), 31.2)).toEqual({ value: "31.2", unit: "% VWC" });
    expect(joinReading(formatChannelValue(number("%"), 87))).toBe("87%");
  });

  it("uses a true minus sign and a spaced unit", () => {
    expect(joinReading(formatChannelValue(number("dBm"), -61))).toBe("−61 dBm");
  });

  it("formats durations in days and statuses verbatim", () => {
    expect(joinReading(formatChannelValue({ kind: "duration", precision: 0, unit: "s" }, 34 * 86_400))).toBe("34 days");
    expect(joinReading(formatChannelValue({ kind: "status", precision: 0, unit: "" }, "PASS"))).toBe("PASS");
  });

  it("falls back to the raw value without a channel", () => {
    expect(joinReading(formatChannelValue(undefined, 12))).toBe("12");
  });
});

describe("formatWhen", () => {
  const now = new Date(2026, 8, 13, 12, 0);

  it("says today or yesterday with a 24-hour time", () => {
    expect(formatWhen(new Date(2026, 8, 13, 6, 12), now)).toBe("today 06:12");
    expect(formatWhen(new Date(2026, 8, 12, 6, 12), now)).toBe("yesterday 06:12");
  });

  it("uses the date further back", () => {
    expect(formatWhen(new Date(2026, 8, 1, 18, 5), now)).toBe("1 Sept 18:05");
  });
});
