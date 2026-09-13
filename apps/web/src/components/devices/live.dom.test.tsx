// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as data from "@/mocks/data";
import { LiveDashboard } from "./LiveDashboard";
import { LiveFleet } from "./LiveFleet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }));

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  closed = false;
  readyState = 0;
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.dispatchEvent(new Event("open"));
  }
  deliver(type: string, payload: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(payload) }));
  }
}

let container: HTMLDivElement;
let root: Root;
const source = () => FakeEventSource.instances.at(-1)!;
const text = () => container.textContent ?? "";
const NOW = "2026-09-13T12:00:00Z";

beforeEach(() => {
  FakeEventSource.instances = [];
  refresh.mockReset();
  vi.stubGlobal("EventSource", FakeEventSource);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("LiveFleet", () => {
  it("subscribes to the tenant stream scoped to its devices, shows live once open, and applies readings to tiles", async () => {
    const fleet = data.fleet();
    await act(async () => root.render(<LiveFleet tenantId="ten_fern" fleet={fleet} initialNow={NOW} />));
    expect(source().url).toMatch(/^\/v1\/tenants\/ten_fern\/stream\?devices=bed-a,bed-b,bed-c,canopy,/);
    expect(text()).not.toContain("· live");

    await act(async () => source().open());
    expect(text()).toContain("Fleet · all healthy · live");
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => source().deliver("reading", { device_id: "bed-a", channel: "soil_vwc", v: 27.44, t: new Date().toISOString() }));
    const bedA = [...container.querySelectorAll("a")].find((a) => a.textContent?.includes("Bed A"))!;
    expect(bedA.textContent).toContain("27.4");
    expect(bedA.textContent).toContain("% VWC");

    // A malformed payload is dropped by the schema parser, not applied.
    await act(async () => source().deliver("reading", { device_id: "bed-a", channel: "soil_vwc", v: 99, t: "not a time" }));
    expect(bedA.textContent).toContain("27.4");

    await act(async () => source().deliver("status", { device_id: "fridge", status: "offline", at: new Date(Date.now() + 60_000).toISOString(), last_reading_at: null }));
    expect(text()).toContain("Fleet · 1 device offline");
  });

  it("refreshes on initial connection and reconnect", async () => {
    await act(async () => root.render(<LiveFleet tenantId="ten_fern" fleet={data.fleet()} initialNow={NOW} />));
    await act(async () => source().open());
    await act(async () => source().open());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("shows reconnect and terminal errors, retries, and ignores the closed source", async () => {
    await act(async () => root.render(<LiveFleet tenantId="ten_fern" fleet={data.fleet()} initialNow={NOW} />));
    const old = source();
    await act(async () => old.open());
    await act(async () => old.dispatchEvent(new Event("error")));
    expect(text()).toContain("Reconnecting — showing last received readings");
    expect(text()).not.toContain("· live");
    old.readyState = 2;
    await act(async () => old.dispatchEvent(new Event("error")));
    expect(text()).toContain("Live readings unavailable");
    await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
    expect(old.closed).toBe(true);
    expect(source()).not.toBe(old);
    await act(async () => old.deliver("reading", { device_id: "bed-a", channel: "soil_vwc", v: 99, t: new Date().toISOString() }));
    expect(text()).not.toContain("99.0");
    await act(async () => source().open());
    expect(text()).toContain("· live");
  });

  it("closes while hidden and reconnects when visible without accepting old callbacks", async () => {
    let visible = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible });
    await act(async () => root.render(<LiveFleet tenantId="ten_fern" fleet={data.fleet()} initialNow={NOW} />));
    const old = source();
    await act(async () => old.open());
    await act(async () => { visible = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
    expect(old.closed).toBe(true);
    expect(text()).toContain("Live readings paused");
    await act(async () => old.open());
    expect(text()).not.toContain("· live");
    await act(async () => { visible = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
    expect(source()).not.toBe(old);
    await act(async () => source().open());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("renders an empty fleet without opening an unscoped stream", async () => {
    await act(async () => root.render(<LiveFleet tenantId="ten_fern" fleet={{ stats: { device_count: 0, readings_per_day: 0, online_ratio: 0 }, systems: [] }} initialNow={NOW} />));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(text()).toContain("No devices yet");
    expect(text()).not.toContain("all healthy");
  });

  it("an older server snapshot preserves newer streamed readings", async () => {
    await act(async () => root.render(<LiveFleet tenantId="ten_fern" fleet={data.fleet()} initialNow={NOW} />));
    await act(async () => source().deliver("reading", { device_id: "bed-a", channel: "soil_vwc", v: 27.4, t: new Date().toISOString() }));
    expect(text()).toContain("27.4");
    await act(async () => root.render(<LiveFleet tenantId="ten_fern" fleet={data.fleet()} initialNow={NOW} />));
    expect(text()).toContain("27.4");
  });
});

describe("LiveDashboard", () => {
  it("subscribes for one device and updates the chart's current value and the status line", async () => {
    const dashboard = data.dashboard("bed-a")!;
    await act(async () =>
      root.render(<LiveDashboard tenantId="ten_fern" dashboard={dashboard} initialNow={NOW} aside={<aside>chat</aside>} below={<p>rules</p>} />),
    );
    expect(source().url).toBe("/v1/tenants/ten_fern/stream?devices=bed-a");
    expect(text()).toContain("rules");
    expect(text()).toContain("chat");

    await act(async () => source().open());
    expect(text()).toContain("· live");
    await act(async () => source().deliver("reading", { device_id: "bed-a", channel: "soil_vwc", v: 29.96, t: new Date().toISOString() }));
    expect(text()).toContain("30.0");
    // Another device's reading is ignored.
    await act(async () => source().deliver("reading", { device_id: "bed-b", channel: "soil_vwc", v: 1, t: new Date().toISOString() }));
    expect(text()).toContain("30.0");
    expect(text()).not.toContain("1.0 % VWC");
  });
});
