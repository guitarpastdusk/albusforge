import {
  ActionProposal,
  AskResponse,
  DeviceAction,
  BuildDetail,
  BuildList,
  CreatedBuild,
  DeviceDashboard,
  DeviceTile,
  Fleet,
  Me,
  MessageList,
  PostMessageResponse,
  routes,
  Usage,
  VerifyCodeResponse,
} from "@albusforge/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiRequestError, request } from "@/lib/api/core";
import * as data from "./data";
import { mockSession, mockSessionCookie, mockTransport } from "./index";

const get = <S extends Parameters<typeof request>[3]>(path: string, schema: S) =>
  request(mockTransport, "GET", path, schema);

const post = <S extends Parameters<typeof request>[3]>(path: string, schema: S, body: unknown) =>
  request(mockTransport, "POST", path, schema, body);

const patch = <S extends Parameters<typeof request>[3]>(path: string, schema: S, body: unknown) =>
  request(mockTransport, "PATCH", path, schema, body);

describe("every mock parses against the schema", () => {
  it("session", async () => {
    await expect(get(routes.me.get.path(), Me)).resolves.toBeTruthy();
  });

  it("usage", async () => {
    const usage = await get(routes.usage.path(), Usage);
    expect(Date.parse(usage.period.end)).toBeGreaterThan(Date.parse(usage.period.start));
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

});

describe("mock transport errors", () => {
  it("returns the API error shape as a 404 for an unknown id", async () => {
    const call = get(routes.devices.dashboard.path("nope"), DeviceDashboard);
    await expect(call).rejects.toBeInstanceOf(ApiRequestError);
    await expect(call).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("answers 501 for the showcase and listings, like gateway until they're built, so local dev shows the example builds", async () => {
    for (const path of [routes.showcase.path(), routes.listings.list.path(), routes.listings.get.path("fridge-monitor")]) {
      await expect(get(path, z.unknown())).rejects.toMatchObject({ status: 501 });
    }
  });

  it("returns 501 for a route with no mock", async () => {
    await expect(get(routes.devices.series.path("bed-a"), DeviceDashboard)).rejects.toMatchObject({
      status: 501,
      code: "no_mock",
    });
  });
});

describe("mock conversation, device chat and sign-in", () => {
  it("a new build follows the prototype's script: asking with a spec and candidate parts, then planning and ready after the third exchange", async () => {
    const created = await post(routes.builds.create.path(), CreatedBuild, {
      ask_text: "A soil moisture sensor for my greenhouse",
      client_message_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(created).toMatchObject({ id: created.build_id, ready: null });
    const { build_id } = created;

    // Replies are immediate under vitest.
    let transcript = await get(routes.builds.messages.path(build_id), MessageList);
    expect(transcript.messages.map((m) => [m.role, m.client_message_id])).toEqual([
      ["user", "11111111-1111-4111-8111-111111111111"],
      ["assistant", null],
    ]);
    // One question a turn, with one-tap answers on the spec's open question.
    expect(transcript.messages[1]!.text).toMatch(/^Good brief\. Will it be plugged in to USB power, or does it need to run on a battery\?$/);
    let detail = await get(routes.builds.get.path(build_id), BuildDetail);
    expect(detail).toMatchObject({ status: "asking", spec_version: 1, ready: null });
    expect(detail.candidate_parts?.map((p) => [p.id, p.matched_capabilities])).toEqual([["P-005", ["read.soil_moisture_pct"]]]);
    expect((detail.spec as { open_questions: { question: string; options?: string[] }[] }).open_questions).toEqual([
      { field: "power.source", question: "Will it be plugged in to USB power, or does it need to run on a battery?", options: ["USB power", "Battery"] },
    ]);

    const first = await post(routes.builds.postMessage.path(build_id), PostMessageResponse, {
      text: "One bed, and we have Wi-Fi",
      client_message_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(first.message).toMatchObject({ role: "user", text: "One bed, and we have Wi-Fi", client_message_id: "22222222-2222-4222-8222-222222222222" });
    transcript = await get(routes.builds.messages.path(build_id), MessageList);
    expect(transcript.messages[3]!.text).toMatch(/^Got it\. Here's my plan:/);
    detail = await get(routes.builds.get.path(build_id), BuildDetail);
    expect(detail.candidate_parts?.map((p) => p.id)).toEqual(["C-001", "E-001", "P-005"]);

    await post(routes.builds.postMessage.path(build_id), PostMessageResponse, { text: "go", client_message_id: "33333333-3333-4333-8333-333333333333" });
    transcript = await get(routes.builds.messages.path(build_id), MessageList);
    expect(transcript.messages).toHaveLength(6);
    expect(transcript.messages[5]!.text).toMatch(/^Done — design finalized below\./);
    expect(await get(routes.builds.get.path(build_id), BuildDetail)).toMatchObject({
      status: "planning",
      spec: { settled: true },
      ready: { name: "Greenhouse soil monitor", parts: expect.arrayContaining([expect.objectContaining({ part_id: "C-001", label: "ESP32-S3 brain" })]) },
    });
  });

  it("a replayed client_message_id returns the same build or message (200), with no new turn", async () => {
    const body = { ask_text: "A fridge monitor", client_message_id: "44444444-4444-4444-8444-444444444444" };
    const first = await mockTransport("POST", routes.builds.create.path(), body);
    const again = await mockTransport("POST", routes.builds.create.path(), body);
    expect([first.status, again.status]).toEqual([201, 200]);
    const id = CreatedBuild.parse(first.json).build_id;
    expect(CreatedBuild.parse(again.json).build_id).toBe(id);

    const message = { text: "It's a chest fridge", client_message_id: "55555555-5555-4555-8555-555555555555" };
    const sent = await mockTransport("POST", routes.builds.postMessage.path(id), message);
    const resent = await mockTransport("POST", routes.builds.postMessage.path(id), message);
    expect([sent.status, resent.status]).toEqual([202, 200]);
    expect(PostMessageResponse.parse(resent.json).message.id).toBe(PostMessageResponse.parse(sent.json).message.id);
    expect((await get(routes.builds.messages.path(id), MessageList)).messages).toHaveLength(4);
  });

  it("posting to an unknown build is a 404; an empty message, or one without client_message_id, is a 400", async () => {
    const clientId = "66666666-6666-4666-8666-666666666666";
    await expect(post(routes.builds.postMessage.path("nope"), z.unknown(), { text: "hi", client_message_id: clientId })).rejects.toMatchObject({ status: 404 });
    await expect(post(routes.builds.create.path(), CreatedBuild, { ask_text: " " })).rejects.toMatchObject({ status: 400 });
    const { build_id } = await post(routes.builds.create.path(), CreatedBuild, { ask_text: "A sensor" });
    await expect(post(routes.builds.postMessage.path(build_id), z.unknown(), { text: "hi" })).rejects.toMatchObject({ status: 400 });
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
    expect(bedC.permissions).toEqual({ edit_actions: true });
  });

});

describe("mock closed-loop rules (ADR 0010)", () => {
  beforeEach(() => data.resetActions());

  it("toggling a rule returns it pending, and the dashboard reflects it until reset", async () => {
    const off = await patch(routes.devices.actions.setEnabled.path("bed-a", "act-irrigate"), DeviceAction, { enabled: false });
    expect(off).toMatchObject({ id: "act-irrigate", enabled: false, sync: "pending" });
    const dashboard = await get(routes.devices.dashboard.path("bed-a"), DeviceDashboard);
    expect(dashboard.actions?.find((a) => a.id === "act-irrigate")).toMatchObject({ enabled: false, sync: "pending" });

    await expect(patch(routes.devices.actions.setEnabled.path("bed-a", "nope"), DeviceAction, { enabled: true })).rejects.toMatchObject({ status: 404 });
    await expect(patch(routes.devices.actions.setEnabled.path("bed-a", "act-irrigate"), DeviceAction, { enabled: "yes" })).rejects.toMatchObject({ status: 400 });
  });

  it("plain words become a proposal; confirming it creates a pending rule on a device that had none", async () => {
    const proposal = await post(routes.devices.actions.propose.path("bed-c"), ActionProposal, { text: "water for 5 min when soil drops below 22%" });
    expect(proposal).toMatchObject({ kind: "SERVO", rule: "Soil moisture < 22% → water for 5 min", issues: [] });
    expect(Date.parse(proposal.expires_at)).toBeGreaterThan(Date.now());

    const created = await post(routes.devices.actions.create.path("bed-c"), DeviceAction, { proposal_id: proposal.id });
    expect(created).toMatchObject({ kind: "SERVO", rule: proposal.rule, enabled: true, sync: "pending" });
    expect((await get(routes.devices.dashboard.path("bed-c"), DeviceDashboard)).actions).toEqual([created]);

    // Confirming again (a retry after a lost response) returns the same rule and creates nothing.
    const again = await mockTransport("POST", routes.devices.actions.create.path("bed-c"), { proposal_id: proposal.id });
    expect(again.status).toBe(200);
    expect(again.json).toEqual(created);
    expect((await get(routes.devices.dashboard.path("bed-c"), DeviceDashboard)).actions).toHaveLength(1);
    // But not on another device.
    await expect(post(routes.devices.actions.create.path("bed-a"), DeviceAction, { proposal_id: proposal.id })).rejects.toMatchObject({ status: 404 });
  });

  it("each write bumps the rule's version; an ack flips it to synced on the next dashboard", async () => {
    const first = await patch(routes.devices.actions.setEnabled.path("bed-a", "act-irrigate"), DeviceAction, { enabled: false });
    const second = await patch(routes.devices.actions.setEnabled.path("bed-a", "act-irrigate"), DeviceAction, { enabled: true });
    expect([first.version, second.version]).toEqual([2, 3]);
    data.ackActions("bed-a");
    const dashboard = await get(routes.devices.dashboard.path("bed-a"), DeviceDashboard);
    expect(dashboard.actions?.find((a) => a.id === "act-irrigate")).toMatchObject({ enabled: true, sync: "synced", version: 3 });
  });

  it("a proposal with issues is 409 on confirm; a proposal for one device can't be confirmed on another", async () => {
    const vague = await post(routes.devices.actions.propose.path("bed-a"), ActionProposal, { text: "when it's dry" });
    expect(vague.issues.length).toBeGreaterThan(0);
    await expect(post(routes.devices.actions.create.path("bed-a"), DeviceAction, { proposal_id: vague.id })).rejects.toMatchObject({
      status: 409,
      code: "unresolved_proposal",
    });

    const clean = await post(routes.devices.actions.propose.path("bed-a"), ActionProposal, { text: "text me when battery is below 10%" });
    await expect(post(routes.devices.actions.create.path("bed-b"), DeviceAction, { proposal_id: clean.id })).rejects.toMatchObject({ status: 404 });
    await expect(post(routes.devices.actions.propose.path("nope"), ActionProposal, { text: "text me when battery is below 10%" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("mock cookies", () => {
  it("creating a build sets the anonymous owner cookie; verifying sets the session and clears it", async () => {
    const created = await mockTransport("POST", routes.builds.create.path(), { ask_text: "A sensor" });
    expect(created.setCookies).toEqual([expect.stringMatching(/^__Host-albus_anon=mock-anon-bld_\w+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=\d+$/)]);

    const verified = await mockTransport("POST", routes.auth.verify.path(), { email: "you@example.com", code: "123456" });
    expect(verified.setCookies).toEqual([
      expect.stringMatching(/^__Host-albus_session=mock-session\.[A-Za-z0-9_-]+;.*Max-Age=\d+$/),
      expect.stringMatching(/^__Host-albus_anon=;.*Max-Age=0$/),
    ]);
  });
});

describe("mock sessions", () => {
  it("verify issues a cookie that mockSession reads back as that email's session", async () => {
    const verified = await mockTransport("POST", routes.auth.verify.path(), { email: "sam@example.org", code: "123456" });
    const value = verified.setCookies!.find((line) => line.startsWith("__Host-albus_session="))!.split(";")[0]!.split("=")[1]!;
    expect(value).toBe(mockSessionCookie("sam@example.org"));
    expect(mockSession(value)?.user).toMatchObject({ email: "sam@example.org", display_name: null });
  });

  it.each(["", "mock-session", "mock-session.", "mock-session.!!", "other.c2FtQGV4YW1wbGUub3Jn", mockSessionCookie("not an email")])(
    "rejects %j",
    (value) => {
      expect(mockSession(value)).toBeNull();
    },
  );

  it("sign out clears the session cookie", async () => {
    const response = await mockTransport("POST", routes.auth.signOut.path(), undefined);
    expect(response.status).toBe(204);
    expect(response.setCookies).toEqual([expect.stringMatching(/^__Host-albus_session=;.*Max-Age=0$/)]);
  });
});
