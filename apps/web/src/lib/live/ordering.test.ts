import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as data from "@/mocks/data";
import { applyReadingToFleet, applyStatusToFleet, mergeFleetSnapshot } from "./live-fleet";
import { applyReadingToDashboard, applyStatusToDashboard, mergeDashboardSnapshot } from "./live-dashboard";

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 13, 12, 0, seconds)).toISOString();
const reading = (channel: string, seconds: number, v: number | string = 27) => ({ device_id: "bed-a", channel, v, t: at(seconds) });
const status = (seconds: number, state: "online" | "offline" = "offline") => ({ device_id: "bed-a", status: state, at: at(seconds), last_reading_at: at(0) });
const tile = (fleet: ReturnType<typeof data.fleet>) => fleet.systems[0]!.devices[0]!;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(at(0))); });
afterEach(() => vi.useRealTimers());

describe("live event ordering", () => {
  it("tracks displayed channel age separately from another channel", () => {
    const fleet = applyReadingToFleet(data.fleet(), reading("battery", 30, 80));
    const next = applyReadingToFleet(fleet, reading("soil_vwc", 20));
    expect(tile(next)).toMatchObject({ value: "27.0", value_at: at(20), last_reading_at: at(30) });
    expect(applyReadingToFleet(next, reading("soil_vwc", 10))).toBe(next);
  });

  it("keeps the displayed timestamp when a status or refreshed device age advances another channel", () => {
    const base = data.fleet();
    const observed = applyStatusToFleet(base, { ...status(40), last_reading_at: at(30) });
    expect(tile(applyReadingToFleet(observed, reading("soil_vwc", 20))).value).toBe("27.0");
    const otherChannel = applyReadingToFleet(base, reading("battery", 30, 80));
    const merged = mergeFleetSnapshot(base, otherChannel);
    expect(tile(applyReadingToFleet(merged, reading("soil_vwc", 20))).value).toBe("27.0");
    const dashboard = data.dashboard("bed-a")!;
    const live = applyStatusToDashboard(dashboard, { ...status(40), last_reading_at: at(30) });
    expect(mergeDashboardSnapshot(dashboard, live).device.last_reading_at).toBe(at(30));
  });

  it("ignores status replay and does not let historical readings resurrect an offline device", () => {
    const fleet = applyStatusToFleet(data.fleet(), status(30));
    expect(applyStatusToFleet(fleet, status(20, "online"))).toBe(fleet);
    expect(tile(applyReadingToFleet(fleet, reading("soil_vwc", 20))).status).toBe("offline");
    expect(tile(applyReadingToFleet(fleet, reading("soil_vwc", 40))).status).toBe("online");
    const dashboard = applyStatusToDashboard(data.dashboard("bed-a")!, status(30));
    expect(applyStatusToDashboard(dashboard, status(20, "online"))).toBe(dashboard);
    expect(applyReadingToDashboard(dashboard, reading("soil_vwc", 20)).device.status).toBe("offline");
    expect(applyReadingToDashboard(dashboard, reading("soil_vwc", 40)).device.status).toBe("online");
  });

  it("never moves last-reading time backwards with an offline observation", () => {
    const fleet = applyReadingToFleet(data.fleet(), reading("soil_vwc", 20));
    expect(tile(applyStatusToFleet(fleet, status(30))).last_reading_at).toBe(at(20));
    const dashboard = applyReadingToDashboard(data.dashboard("bed-a")!, reading("soil_vwc", 20));
    expect(applyStatusToDashboard(dashboard, status(30)).device.last_reading_at).toBe(at(20));
  });

  it("drops unknown dashboard channels and values of the wrong type", () => {
    const dashboard = data.dashboard("bed-a")!;
    expect(applyReadingToDashboard(dashboard, reading("unknown", 10))).toBe(dashboard);
    expect(applyReadingToDashboard(dashboard, reading("soil_vwc", 10, "wet"))).toBe(dashboard);
    expect(applyReadingToDashboard(dashboard, reading("selftest", 10, 1))).toBe(dashboard);
    const fleet = data.fleet();
    expect(applyReadingToFleet(fleet, reading("soil_vwc", 10, "wet"))).toBe(fleet);
  });
});

describe("snapshot reconciliation", () => {
  it("keeps newer readings and presence but accepts current membership and metadata", () => {
    const base = data.fleet();
    const live = applyStatusToFleet(applyReadingToFleet(base, reading("soil_vwc", 20)), status(30));
    const snapshot = structuredClone(base);
    tile(snapshot).name = "Renamed probe";
    snapshot.systems[0]!.devices.splice(1, 1);
    const merged = mergeFleetSnapshot(snapshot, live);
    expect(tile(merged)).toMatchObject({ name: "Renamed probe", value: "27.0", status: "offline", status_at: at(30) });
    expect(merged.systems[0]!.devices.some((device) => device.id === "bed-b")).toBe(false);
    const newer = applyReadingToFleet(base, reading("soil_vwc", 40, 28));
    expect(tile(mergeFleetSnapshot(newer, live))).toMatchObject({ value: "28.0", status: "online" });
  });

  it("preserves live latest and offline status while taking fresh rollups, widgets and permissions", () => {
    const base = data.dashboard("bed-a")!;
    const live = applyStatusToDashboard(applyReadingToDashboard(base, reading("soil_vwc", 20)), status(30));
    const snapshot = structuredClone(base);
    snapshot.permissions = { edit_actions: false };
    snapshot.series[0]!.points[0]!.v = 12;
    const merged = mergeDashboardSnapshot(snapshot, live);
    expect(merged.latest.soil_vwc).toEqual({ v: 27, t: at(20) });
    expect(merged.device.status).toBe("offline");
    expect(merged.series).toEqual(snapshot.series);
    expect(merged.permissions).toEqual({ edit_actions: false });
    snapshot.channels = snapshot.channels.filter((channel) => channel.key !== "soil_vwc");
    delete snapshot.latest.soil_vwc;
    expect(mergeDashboardSnapshot(snapshot, live).latest.soil_vwc).toBeUndefined();
  });

  it("retains all raw samples received after the refreshed series", () => {
    const base = data.dashboard("bed-a")!;
    base.series[0]!.bucket = "raw";
    const first = applyReadingToDashboard(base, reading("soil_vwc", 10));
    const live = applyReadingToDashboard(first, reading("soil_vwc", 20));
    const merged = mergeDashboardSnapshot(base, live);
    expect(merged.series[0]!.points.slice(-2)).toEqual([{ t: at(10), v: 27 }, { t: at(20), v: 27 }]);
  });
});

describe("delayed raw history", () => {
  it("inserts delayed samples without regressing latest or presence, and retains them across refresh", () => {
    const base = data.dashboard("bed-a")!;
    base.series = [{ channel: "soil_vwc", bucket: "raw", points: [{ t: at(0), v: 30 }] }];
    base.latest.soil_vwc = { t: at(0), v: 30 };
    const newer = applyStatusToDashboard(applyReadingToDashboard(base, reading("soil_vwc", 20, 32)), status(30));
    const delayed = applyReadingToDashboard(newer, reading("soil_vwc", 10, 31));
    expect(delayed.latest).toBe(newer.latest);
    expect(delayed.device).toBe(newer.device);
    expect(delayed.series[0]!.points).toEqual([{ t: at(0), v: 30 }, { t: at(10), v: 31 }, { t: at(20), v: 32 }]);
    expect(applyReadingToDashboard(delayed, reading("soil_vwc", 10, 99))).toBe(delayed);
    const snapshot = structuredClone(newer);
    snapshot.series[0]!.points[0]!.v = 29;
    const merged = mergeDashboardSnapshot(snapshot, delayed);
    expect(merged.series[0]!.points).toEqual([{ t: at(0), v: 29 }, { t: at(10), v: 31 }, { t: at(20), v: 32 }]);
    expect(merged.latest.soil_vwc).toEqual({ t: at(20), v: 32 });
    expect(merged.device.status).toBe("offline");
  });

  it("keeps delayed insertion bounded by the window and cap and leaves aggregates untouched", () => {
    const base = data.dashboard("bed-a")!;
    base.series = [{ channel: "soil_vwc", bucket: "raw", points: Array.from({ length: 600 }, (_, index) => ({ t: at(index + 1), v: index })) }];
    base.latest.soil_vwc = { t: at(600), v: 599 };
    expect(applyReadingToDashboard(base, reading("soil_vwc", 0))).toBe(base);
    expect(applyReadingToDashboard(base, reading("soil_vwc", -86_400))).toBe(base);
    const aggregate = { ...base, series: base.series.map((series) => ({ ...series, bucket: "1h" as const })) };
    expect(applyReadingToDashboard(aggregate, reading("soil_vwc", 0))).toBe(aggregate);
    const refreshed = { ...base, series: [{ ...base.series[0]!, points: [{ t: at(90_000), v: 1 }] }], latest: { soil_vwc: { t: at(90_000), v: 1 } } };
    expect(mergeDashboardSnapshot(refreshed, base).series[0]!.points).toEqual(refreshed.series[0]!.points);
  });
});
