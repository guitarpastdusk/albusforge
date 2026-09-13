import type { DeviceDashboard, Fleet } from "@albusforge/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as data from "@/mocks/data";
import { mockTenantStream, step, walkers } from "@/mocks/stream";
import { applyReadingToDashboard, applyStatusToDashboard } from "./live-dashboard";
import { applyReadingToFleet, applyStatusToFleet, onlineRatio } from "./live-fleet";

const T0 = "2026-09-13T12:00:00Z";
const T1 = "2026-09-13T12:00:30Z";

describe("live fleet", () => {
  let fleet: Fleet;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    fleet = data.fleet();
  });
  afterEach(() => vi.useRealTimers());
  const tile = (f: Fleet, id: string) => f.systems.flatMap((s) => s.devices).find((d) => d.id === id)!;

  it("a reading on the tile's channel reformats the value and refreshes the age; other channels only the age", () => {
    const next = applyReadingToFleet(fleet, { device_id: "bed-a", channel: "soil_vwc", v: 27.456, t: T1 });
    expect(tile(next, "bed-a")).toMatchObject({ value: "27.5", unit: "% VWC", status: "online", last_reading_at: T1 });
    const other = applyReadingToFleet(fleet, { device_id: "bed-a", channel: "battery", v: 80, t: T1 });
    expect(tile(other, "bed-a")).toMatchObject({ value: "31.2", last_reading_at: T1 });
    // Untouched tiles keep identity; an unknown device changes nothing.
    expect(tile(next, "bed-b")).toBe(tile(fleet, "bed-b"));
    expect(applyReadingToFleet(fleet, { device_id: "nope", channel: "soil_vwc", v: 1, t: T1 })).toBe(fleet);
  });

  it("a never-seen device comes alive on its first reading, and a stale reading is ignored", () => {
    const first = applyReadingToFleet(fleet, { device_id: "bed-c", channel: "soil_vwc", v: 40, t: T1 });
    expect(tile(first, "bed-c")).toMatchObject({ status: "online", value: "40.0", unit: "% VWC", last_reading_at: T1 });
    const stale = applyReadingToFleet(first, { device_id: "bed-c", channel: "soil_vwc", v: 1, t: T0 });
    expect(stale).toBe(first);
  });

  it("a status event marks a device offline and the online ratio follows the tiles", () => {
    const next = applyStatusToFleet(fleet, { device_id: "fridge", status: "offline", at: new Date(Date.now() + 60_000).toISOString(), last_reading_at: T0 });
    expect(tile(next, "fridge")).toMatchObject({ status: "offline", status_at: new Date(Date.now() + 60_000).toISOString(), last_reading_at: T0 });
    // 7 reporting devices (bed-c never seen), 6 online.
    expect(onlineRatio(next)).toBeCloseTo(6 / 7);
    expect(next.stats.online_ratio).toBeCloseTo(6 / 7);
  });
});

describe("live dashboard", () => {
  const dashboard: DeviceDashboard = data.dashboard("bed-a")!;

  it("updates latest without substituting a raw sample for a server rollup", () => {
    const t = new Date(Date.now() + 60_000).toISOString();
    const next = applyReadingToDashboard(dashboard, { device_id: "bed-a", channel: "soil_vwc", v: 30.1, t });
    expect(next.latest.soil_vwc).toEqual({ v: 30.1, t });
    expect(next.series).toEqual(dashboard.series);
  });

  it("appends raw points, deduplicates timestamps and trims the widget window", () => {
    const raw = { ...dashboard, series: dashboard.series.map((s) => ({ ...s, bucket: "raw" as const })) };
    const far = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const event = { device_id: "bed-a", channel: "soil_vwc", v: 29, t: far };
    const next = applyReadingToDashboard(raw, event);
    expect(next.series[0]!.points).toEqual([{ t: far, v: 29 }]);
    expect(applyReadingToDashboard(next, event)).toBe(next);
  });

  it("ignores other devices, stale readings, and keeps series for string values", () => {
    expect(applyReadingToDashboard(dashboard, { device_id: "bed-b", channel: "soil_vwc", v: 1, t: T1 })).toBe(dashboard);
    expect(applyReadingToDashboard(dashboard, { device_id: "bed-a", channel: "soil_vwc", v: 1, t: "2020-01-01T00:00:00Z" })).toBe(dashboard);
    const status = applyReadingToDashboard(dashboard, { device_id: "bed-a", channel: "selftest", v: "FAIL", t: new Date().toISOString() });
    expect(status.latest.selftest?.v).toBe("FAIL");
    expect(status.series).toBe(dashboard.series);
  });

  it("a status event changes presence without touching readings", () => {
    const next = applyStatusToDashboard(dashboard, { device_id: "bed-a", status: "offline", at: new Date(Date.now() + 60_000).toISOString(), last_reading_at: null });
    expect(next.device.status).toBe("offline");
    expect(next.device.last_reading_at).toBe(dashboard.device.last_reading_at);
    expect(next.latest).toBe(dashboard.latest);
  });
});

describe("mock tenant stream", () => {
  it("walks only online numeric tiles the request asked for, within range and at precision", () => {
    expect(walkers([]).map((w) => w.deviceId)).toEqual(["bed-a", "bed-b", "freezer"]);
    expect(walkers(["bed-a", "bed-c"]).map((w) => w.deviceId)).toEqual(["bed-a"]);
    const w = walkers(["bed-a"])[0]!;
    expect(w.value).toBe(31.2);
    const up = step(w, () => 1);
    expect(up.value).toBeGreaterThan(31.2);
    expect(up.value).toBeLessThanOrEqual(60);
    expect(String(up.value).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(1);
    expect(step({ ...w, value: 60 }, () => 1).value).toBe(60);
  });

  it("replays a status per device on connect, then emits readings, and stops on abort", async () => {
    const controller = new AbortController();
    const response = mockTenantStream(data.me().tenant.id, ["bed-a"], controller.signal, 5);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!/event: reading/.test(text)) text += decoder.decode((await reader.read()).value);
    expect(text).toMatch(/^id: 1\nevent: status\ndata: \{"device_id":"bed-a","status":"online"/);
    expect(text).toMatch(/event: reading\ndata: \{"device_id":"bed-a","channel":"soil_vwc","v":[\d.]+,"t":"/);
    controller.abort();
    const rest = await reader.read();
    // Drain to the end: the stream closes after abort.
    let done = rest.done;
    while (!done) done = (await reader.read()).done;
    expect(done).toBe(true);
  });

  it("answers 404 for a tenant the session isn't in", () => {
    expect(mockTenantStream("ten_other", [], new AbortController().signal).status).toBe(404);
  });
});
