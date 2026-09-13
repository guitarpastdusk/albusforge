import {
  BuildDetail,
  BuildList,
  DeviceDashboard,
  Fleet,
  Listing,
  ListingList,
  Me,
  MessageList,
  routes,
  Showcase,
  Usage,
} from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { ApiRequestError, request } from "@/lib/api/core";
import * as data from "./data";
import { mockTransport } from "./index";

const get = <S extends Parameters<typeof request>[3]>(path: string, schema: S) =>
  request(mockTransport, "GET", path, schema);

describe("every mock parses against the schema", () => {
  it("session", async () => {
    await expect(get(routes.me.get.path(), Me)).resolves.toBeTruthy();
  });

  it("usage", async () => {
    const usage = await get(routes.usage.path(), Usage);
    expect(Date.parse(usage.period.end)).toBeGreaterThan(Date.parse(usage.period.start));
  });

  it("showcase", async () => {
    const { cards } = await get(routes.showcase.path(), Showcase);
    expect(cards.length).toBeGreaterThanOrEqual(6);
  });

  it("builds, their detail and their messages", async () => {
    const { builds } = await get(routes.builds.list.path(), BuildList);
    for (const id of [...builds.map((b) => b.id), data.ANONYMOUS_BUILD_ID]) {
      await expect(get(routes.builds.get.path(id), BuildDetail)).resolves.toMatchObject({ id });
      await expect(get(routes.builds.messages.path(id), MessageList)).resolves.toBeTruthy();
    }
  });

  it("fleet and every device's dashboard", async () => {
    const fleet = await get(routes.tenants.devices.path(data.me().tenant.id), Fleet);
    const ids = fleet.systems.flatMap((s) => s.devices.map((d) => d.id));
    expect(ids).toContain("bed-a");
    for (const id of ids) {
      const dashboard = await get(routes.devices.dashboard.path(id), DeviceDashboard);
      for (const widget of dashboard.widgets) {
        expect(dashboard.channels.map((c) => c.key)).toContain(widget.channel);
      }
    }
  });

  it("listings, filtered and single", async () => {
    const all = await get(routes.listings.list.path(), ListingList);
    const garden = await get(`${routes.listings.list.path()}?tags=garden`, ListingList);
    expect(garden.listings.length).toBeLessThan(all.listings.length);
    expect(garden.listings.every((l) => l.category === "garden")).toBe(true);
    for (const { id } of all.listings) {
      await expect(get(routes.listings.get.path(id), Listing)).resolves.toMatchObject({ id });
    }
  });
});

describe("mock transport errors", () => {
  it("returns the API error shape as a 404 for an unknown id", async () => {
    const call = get(routes.devices.dashboard.path("nope"), DeviceDashboard);
    await expect(call).rejects.toBeInstanceOf(ApiRequestError);
    await expect(call).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("returns 501 for a route with no mock", async () => {
    await expect(get(routes.devices.series.path("bed-a"), DeviceDashboard)).rejects.toMatchObject({
      status: 501,
      code: "no_mock",
    });
  });
});
