import type { DeviceDashboard, DeviceTile } from "@albusforge/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeviceStatusHeader } from "./DeviceStatusHeader";
import { DeviceTileBody } from "./DeviceTileBody";

const NOW = new Date("2026-09-13T12:00:00Z");
const FORTY_SECONDS_AGO = "2026-09-13T11:59:20Z";

const neverSeenTile: DeviceTile = {
  id: "bed-c",
  name: "Bed C — soil probe",
  accent: "green",
  status: "never_seen",
  value: null,
  unit: null,
  metric: "Soil moisture",
  last_reading_at: null,
};

const onlineTile: DeviceTile = {
  ...neverSeenTile,
  id: "bed-a",
  name: "Bed A — soil probe",
  status: "online",
  value: "31.2",
  unit: "% VWC",
  last_reading_at: FORTY_SECONDS_AGO,
};

const header = (device: Partial<DeviceDashboard["device"]>): DeviceDashboard["device"] => ({
  id: "bed-c",
  build_id: "greenhouse-soil",
  name: "Bed C — soil probe",
  status: "never_seen",
  last_reading_at: null,
  chips: [],
  ...device,
});

describe("DeviceTileBody", () => {
  it("renders the awaiting state instead of a value and an age", () => {
    const html = renderToStaticMarkup(<DeviceTileBody device={neverSeenTile} now={NOW} />);
    expect(html).toContain("Awaiting first reading");
    expect(html).toContain("Soil moisture");
    expect(html).not.toMatch(/ago/);
    expect(html).not.toContain("animate-af-pulse");
  });

  it("renders value, unit, age and the online pulse for a reporting device", () => {
    const html = renderToStaticMarkup(<DeviceTileBody device={onlineTile} now={NOW} />);
    expect(html).toContain("31.2");
    expect(html).toContain("% VWC");
    expect(html).toContain("Soil moisture · 40s ago");
    expect(html).toContain("animate-af-pulse");
    expect(html).not.toContain("Awaiting first reading");
  });
});

describe("DeviceStatusHeader", () => {
  it("shows awaiting — not ONLINE — for a never-seen device", () => {
    const html = renderToStaticMarkup(<DeviceStatusHeader device={header({})} now={NOW} />);
    expect(html).toContain("Awaiting first reading");
    expect(html).not.toContain("Online");
    expect(html).not.toContain("animate-af-pulse");
    expect(html).toContain("text-muted");
  });

  it("shows online with the age of the last reading", () => {
    const html = renderToStaticMarkup(
      <DeviceStatusHeader device={header({ status: "online", last_reading_at: FORTY_SECONDS_AGO })} now={NOW} />,
    );
    expect(html).toContain("Online · last reading 40s ago");
    expect(html).toContain("animate-af-pulse");
  });
});
