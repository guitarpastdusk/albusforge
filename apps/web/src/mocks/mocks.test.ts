import {
  AskResponse,
  BuildDetail,
  BuildList,
  CreateBuildResponse,
  DeviceDashboard,
  DeviceTile,
  Fleet,
  Listing,
  ListingList,
  Me,
  MessageList,
  routes,
  Showcase,
  Usage,
  VerifyCodeResponse,
} from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiRequestError, request } from "@/lib/api/core";
import * as data from "./data";
import { mockTransport } from "./index";

const get = <S extends Parameters<typeof request>[3]>(path: string, schema: S) =>
  request(mockTransport, "GET", path, schema);

const post = <S extends Parameters<typeof request>[3]>(path: string, schema: S, body: unknown) =>
  request(mockTransport, "POST", path, schema, body);

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

  it("a provisioned device that has never reported: tile and dashboard both parse", async () => {
    const fleet = await get(routes.tenants.devices.path(data.me().tenant.id), Fleet);
    const tile = fleet.systems.flatMap((s) => s.devices).find((d) => d.id === "bed-c");
    expect(tile).toMatchObject({ status: "never_seen", value: null, unit: null, last_reading_at: null });

    const dashboard = await get(routes.devices.dashboard.path("bed-c"), DeviceDashboard);
    expect(dashboard.device).toMatchObject({ status: "never_seen", last_reading_at: null });
    expect(dashboard.latest).toEqual({});
    expect(dashboard.series).toEqual([]);
    expect(dashboard.widgets.length).toBeGreaterThan(0);
  });

  it("rejects a tile that still carries the old boolean online flag instead of status", () => {
    const withoutStatus = Object.fromEntries(
      Object.entries(data.fleet().systems[0]!.devices[0]!).filter(([key]) => key !== "status"),
    );
    expect(DeviceTile.safeParse({ ...withoutStatus, online: true }).success).toBe(false);
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

describe("mock conversation, device chat and sign-in", () => {
  it("a new build follows the prototype's script and is ready after the third exchange", async () => {
    const { build_id } = await post(routes.builds.create.path(), CreateBuildResponse, {
      ask_text: "A soil moisture sensor for my greenhouse",
    });

    let transcript = await get(routes.builds.messages.path(build_id), MessageList);
    expect(transcript.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(transcript.messages[0]!.text).toBe("A soil moisture sensor for my greenhouse");
    expect(transcript.messages[1]!.text).toMatch(/^Good brief\. Two quick questions:/);
    expect((await get(routes.builds.get.path(build_id), BuildDetail)).ready).toBeNull();

    await post(routes.builds.postMessage.path(build_id), z.unknown(), { text: "One bed, and we have Wi-Fi" });
    transcript = await get(routes.builds.messages.path(build_id), MessageList);
    expect(transcript.messages[3]!.text).toMatch(/^Got it\. Here's my plan:/);
    expect((await get(routes.builds.get.path(build_id), BuildDetail)).ready).toBeNull();

    await post(routes.builds.postMessage.path(build_id), z.unknown(), { text: "go" });
    transcript = await get(routes.builds.messages.path(build_id), MessageList);
    expect(transcript.messages).toHaveLength(6);
    expect(transcript.messages[5]!.text).toMatch(/^Done — design finalized below\./);
    expect((await get(routes.builds.get.path(build_id), BuildDetail)).ready).toMatchObject({
      name: "Greenhouse soil monitor",
      est_price_usd: 34,
      parts: expect.arrayContaining([expect.objectContaining({ label: "ESP32-WROOM" })]),
    });
  });

  it("posting to an unknown build is a 404; an empty message is a 400", async () => {
    await expect(post(routes.builds.postMessage.path("nope"), z.unknown(), { text: "hi" })).rejects.toMatchObject({ status: 404 });
    await expect(post(routes.builds.create.path(), CreateBuildResponse, { ask_text: " " })).rejects.toMatchObject({ status: 400 });
  });

  it("device ask answers with the scripted reply and the query it ran", async () => {
    const answer = await post(routes.devices.ask.path("bed-a"), AskResponse, { text: "How dry is it getting?" });
    expect(answer.message).toMatchObject({ role: "assistant", text: data.DEVICE_REPLY });
    expect(answer.queries[0]).toMatchObject({ tool: "compare_to_baseline" });
    await expect(post(routes.devices.ask.path("nope"), AskResponse, { text: "hi" })).rejects.toMatchObject({ status: 404 });
  });

  it("requesting a code is a 204; any 6 digits verify; anything else is a 400", async () => {
    await expect(post(routes.auth.requestCode.path(), z.unknown(), { email: "you@example.com" })).resolves.toBeNull();
    await expect(post(routes.auth.verify.path(), VerifyCodeResponse, { email: "you@example.com", code: "123456" })).resolves.toMatchObject({
      user: { email: "you@example.com" },
    });
    await expect(post(routes.auth.verify.path(), VerifyCodeResponse, { email: "you@example.com", code: "12345" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("bed-a has three closed-loop actions (on, on, off) and a last action; bed-c has none", async () => {
    const bedA = await get(routes.devices.dashboard.path("bed-a"), DeviceDashboard);
    expect(bedA.actions?.map((a) => [a.kind, a.enabled])).toEqual([
      ["SERVO", true],
      ["API", true],
      ["ALERT", false],
    ]);
    expect(bedA.last_action?.summary).toBe("valve opened");
    expect(bedA.greeting).toMatch(/^Hi — I'm Bed A's soil probe\./);

    const bedC = await get(routes.devices.dashboard.path("bed-c"), DeviceDashboard);
    expect(bedC.actions).toBeUndefined();
  });

  it("the marketplace has twelve builds, seven of them industrial", async () => {
    const { listings } = await get(routes.listings.list.path(), ListingList);
    expect(listings).toHaveLength(12);
    expect(listings.filter((l) => l.category === "industrial")).toHaveLength(7);
    expect(listings.map((l) => l.name)).toEqual(expect.arrayContaining(["The Vibration Prophet", "The Air Marshal"]));
  });
});
