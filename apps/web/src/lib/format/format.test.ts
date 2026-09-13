import { describe, expect, it } from "vitest";
import { formatAgo, formatBytes, formatCompact, pluralize } from "./index";

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
