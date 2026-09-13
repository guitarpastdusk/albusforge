import { afterEach, expect, it, vi } from "vitest";
import { liveReadings } from "./live-state";
import { mockTenantStream } from "./stream";
import * as data from "./data";

afterEach(() => { liveReadings.clear(); vi.resetModules(); });

it("shares stream readings with separately loaded fleet/dashboard snapshots and the next connection", async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = mockTenantStream(data.me().tenant.id, ["bed-a"], controller.signal, 5);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let frames = "";
    while (!frames.includes("event: reading")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("No reading before timeout");
      frames += decoder.decode(chunk.value);
    }
    controller.abort();
    const reading = liveReadings.get("bed-a")!;
    vi.resetModules();
    const pages = await import("./data");
    expect(pages.fleet().systems[0]!.devices[0]).toMatchObject({ value: Number(reading.v).toFixed(1), value_at: reading.t });
    expect(pages.dashboard("bed-a")!.latest.soil_vwc).toEqual({ v: reading.v, t: reading.t });
    const { walkers } = await import("./stream");
    expect(walkers(["bed-a"])[0]!.value).toBe(reading.v);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
});

it("closes immediately for a pre-aborted request", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = mockTenantStream(data.me().tenant.id, [], controller.signal, 5);
  expect((await response.body!.getReader().read()).done).toBe(true);
});

it("removes the abort listener on reader cancellation", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const response = mockTenantStream(data.me().tenant.id, [], controller.signal, 5);
  await response.body!.cancel();
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  controller.abort();
});
