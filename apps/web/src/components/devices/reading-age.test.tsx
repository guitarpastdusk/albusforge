import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import * as data from "@/mocks/data";
import { applyReadingToFleet } from "@/lib/live/live-fleet";
import { DeviceTileBody } from "./DeviceTileBody";

const now = new Date("2026-09-13T12:00:00Z");
const old = "2026-09-13T11:00:00Z";
const render = (device: ReturnType<typeof data.fleet>["systems"][number]["devices"][number]) => renderToStaticMarkup(<DeviceTileBody device={device} now={now} />);

it("renders the soil age after a fresh battery reading, then advances it for fresh soil", () => {
  const fleet = data.fleet();
  const tile = fleet.systems[0]!.devices[0]!;
  tile.last_reading_at = old;
  delete tile.value_at;
  const active = applyReadingToFleet(fleet, { device_id: tile.id, channel: "battery", v: 80, t: now.toISOString() });
  const html = render(active.systems[0]!.devices[0]!);
  expect(html).toContain("31.2");
  expect(html).toContain("1h ago");
  expect(html).not.toContain("now");
  const fresh = applyReadingToFleet(active, { device_id: tile.id, channel: "soil_vwc", v: 28, t: now.toISOString() });
  expect(render(fresh.systems[0]!.devices[0]!)).toContain("now");
});

it("falls back only for an omitted value_at; null means no displayed-channel reading", () => {
  const tile = data.fleet().systems[0]!.devices[0]!;
  tile.last_reading_at = now.toISOString();
  delete tile.value_at;
  expect(render(tile)).toContain("now");
  tile.value_at = null;
  expect(render(tile)).toContain("Awaiting first reading");
  expect(render(tile)).not.toContain("31.2");
  expect(render(tile)).not.toContain("now");
});
