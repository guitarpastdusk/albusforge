import { SESSION_COOKIE } from "@albusforge/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The actions run in Next.js; here only their input validation and outcome logic are under test.
vi.mock("@/lib/api/server", () => ({ apiPost: vi.fn(), sessionClient: vi.fn() }));
vi.mock("@/lib/action-errors", () => ({
  actionFailure: vi.fn(async () => ({ ok: false, message: "failure" })),
  actionIncomplete: vi.fn(async (_action: string, _reason: string, message: string) => ({ ok: false, message })),
}));

const { apiPost, sessionClient } = await import("@/lib/api/server");
const { actionIncomplete } = await import("@/lib/action-errors");
const { requestSignInCode, verifySignInCode } = await import("./auth");
const { refreshBuild, sendBuildMessage, startBuild } = await import("./builds");
const { askDevice } = await import("./devices");

const NON_STRINGS: unknown[] = [null, undefined, 42, true, { email: "you@example.com" }, ["you@example.com"]];

beforeEach(() => {
  vi.mocked(sessionClient).mockReset();
  vi.mocked(apiPost).mockReset();
});

describe("runtime validation of Server Function arguments", () => {
  it.each(NON_STRINGS)("requestSignInCode(%j) returns the validation result without calling gateway", async (input) => {
    await expect(requestSignInCode(input)).resolves.toEqual({ ok: false, message: "Enter a valid email address." });
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it.each(NON_STRINGS)("verifySignInCode with email %j returns the validation result", async (input) => {
    await expect(verifySignInCode(input, "123456")).resolves.toEqual({ ok: false, message: "Enter a valid email address." });
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it.each([null, 123456, { code: "123456" }, "12345", "abcdef"])("verifySignInCode with code %j returns the validation result", async (code) => {
    await expect(verifySignInCode("you@example.com", code)).resolves.toEqual({ ok: false, message: "Enter the 6-digit code from your email." });
    expect(sessionClient).not.toHaveBeenCalled();
  });

  const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it.each(NON_STRINGS)("startBuild(%j) returns the validation result", async (input) => {
    await expect(startBuild(input, UUID, null)).resolves.toMatchObject({ ok: false, message: "Describe the device you want to start." });
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "not-a-uuid", 42])("startBuild with client_message_id %j returns the validation result", async (clientId) => {
    await expect(startBuild("A soil sensor", clientId, null)).resolves.toMatchObject({ ok: false, message: "Describe the device you want to start." });
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it.each([
    [null, "hi", UUID],
    [42, "hi", UUID],
    ["bld_1", null, UUID],
    ["bld_1", { text: "hi" }, UUID],
    ["bld_1", "hi", undefined],
    ["bld_1", "hi", "not-a-uuid"],
  ])("sendBuildMessage(%j, %j, %j) returns the validation result", async (id, text, clientId) => {
    await expect(sendBuildMessage(id, text, clientId)).resolves.toMatchObject({ ok: false, message: "Write a reply to send." });
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it.each([null, 42, {}, ""])("refreshBuild(%j) returns the validation result", async (id) => {
    await expect(refreshBuild(id)).resolves.toMatchObject({ ok: false });
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it.each([
    [null, "hi"],
    ["bed-a", 7],
    ["bed-a", { text: "hi" }],
  ])("askDevice(%j, %j) returns the validation result", async (id, text) => {
    await expect(askDevice(id, text)).resolves.toEqual({ ok: false, message: "Ask a question to send." });
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe("sign-in outcomes", () => {
  const client = (change: "set" | "deleted" | undefined) => ({
    get: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ user: { email: "you@example.com" } }),
    credentialChange: vi.fn((name: string) => (name === SESSION_COOKIE ? change : undefined)),
  });

  it("trims the email inside the schema before sending it", async () => {
    const c = client(undefined);
    vi.mocked(sessionClient).mockResolvedValue(c);
    await expect(requestSignInCode("  you@example.com ")).resolves.toEqual({ ok: true, data: { email: "you@example.com" } });
    expect(c.mutate).toHaveBeenCalledWith("POST", "/v1/auth/code", expect.anything(), { email: "you@example.com" });
  });

  it("reports success only once the session cookie was set", async () => {
    vi.mocked(sessionClient).mockResolvedValue(client("set"));
    await expect(verifySignInCode("you@example.com", "123456")).resolves.toEqual({ ok: true, data: { email: "you@example.com" } });
  });

  it("a verify response without a session cookie is not a sign-in", async () => {
    vi.mocked(sessionClient).mockResolvedValue(client(undefined));
    const result = await verifySignInCode("you@example.com", "123456");
    expect(result).toEqual({ ok: false, message: "We couldn’t finish signing you in. Try again in a moment." });
    expect(actionIncomplete).toHaveBeenCalledWith("verifySignInCode", expect.any(String), expect.any(String));
    // Neither the logged reason nor the result carries the code or email.
    const logged = JSON.stringify(vi.mocked(actionIncomplete).mock.calls) + JSON.stringify(result);
    expect(logged).not.toContain("123456");
    expect(logged).not.toContain("you@example.com");
  });
});

const { ApiRequestError: GatewayRefusal } = await import("@/lib/api/core");
const { actionFailure: loggedFailure } = await import("@/lib/action-errors");

const AT = "2026-09-13T12:00:00Z";
const CLIENT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CREATED = {
  id: "bld_1",
  build_id: "bld_1",
  name: "A soil sensor",
  description: "A soil sensor",
  display_status: "designing",
  device_count: 0,
  updated_at: AT,
  ready: null,
  status: "asking",
  spec_version: null,
  spec: null,
  candidate_parts: [],
};
const ASK = { id: "msg_1", role: "user", text: "A soil sensor", created_at: AT, client_message_id: CLIENT_ID };

describe("a turn gateway refuses before accepting it", () => {
  const refusingClient = (error: Error) => ({
    get: vi.fn().mockResolvedValue({ messages: [] }),
    mutate: vi.fn().mockRejectedValue(error),
    credentialChange: vi.fn(),
  });

  it.each([
    ["409 TURN_IN_PROGRESS", new GatewayRefusal(409, "TURN_IN_PROGRESS", "a reply is still being written", { pending_message_id: "msg_1", retry_after_s: 42 }), /^Still working on the last reply\. Your message wasn’t sent/],
    ["429 RATE_LIMITED", new GatewayRefusal(429, "RATE_LIMITED", "slow down"), /Your message wasn’t sent: wait a moment, then send it again\.$/],
    ["429 RATE_LIMITED with retry_after_s", new GatewayRefusal(429, "RATE_LIMITED", "slow down", { retry_after_s: 7.2 }), /Your message wasn’t sent: wait about 8 seconds, then send it again\.$/],
  ])("%s: says the message wasn't sent (so the draft comes back) and logs nothing", async (_label, error, message) => {
    vi.mocked(loggedFailure).mockClear();
    vi.mocked(sessionClient).mockResolvedValue(refusingClient(error) as never);
    for (const result of [await sendBuildMessage("bld_1", "One more bed", CLIENT_ID), await startBuild("A soil sensor", CLIENT_ID, null)]) {
      expect(result).toEqual({ ok: false, message: expect.stringMatching(message) });
    }
    expect(loggedFailure).not.toHaveBeenCalled();
  });

  it("any other 409 is still a logged failure", async () => {
    vi.mocked(loggedFailure).mockClear();
    vi.mocked(sessionClient).mockResolvedValue(refusingClient(new GatewayRefusal(409, "conflict", "something else")) as never);
    await expect(sendBuildMessage("bld_1", "hi", CLIENT_ID)).resolves.toEqual({ ok: false, message: "failure" });
    expect(loggedFailure).toHaveBeenCalledTimes(1);
  });
});

describe("build conversation outcomes", () => {
  beforeEach(() => vi.mocked(loggedFailure).mockClear());

  it("startBuild sends the client_message_id and returns the new build with its transcript and spec progress", async () => {
    const client = { get: vi.fn().mockResolvedValue({ messages: [ASK] }), mutate: vi.fn().mockResolvedValue(CREATED), credentialChange: vi.fn() };
    vi.mocked(sessionClient).mockResolvedValue(client as never);

    await expect(startBuild("A soil sensor", CLIENT_ID, null)).resolves.toEqual({
      ok: true,
      data: { buildId: "bld_1", messages: [ASK], ready: null, status: "asking", specVersion: null, spec: null, candidateParts: [] },
    });
    expect(client.mutate).toHaveBeenCalledWith("POST", "/v1/builds", expect.anything(), { ask_text: "A soil sensor", client_message_id: CLIENT_ID, expected_tenant_id: null });
  });

  it("startBuild whose transcript read fails still returns the build, showing the ask (logged once, not a failed send)", async () => {
    const client = { get: vi.fn().mockRejectedValue(new TypeError("fetch failed")), mutate: vi.fn().mockResolvedValue(CREATED), credentialChange: vi.fn() };
    vi.mocked(sessionClient).mockResolvedValue(client as never);

    const result = await startBuild("A soil sensor", CLIENT_ID, null);
    expect(result).toMatchObject({ ok: true, data: { buildId: "bld_1", messages: [{ id: `local-${CLIENT_ID}`, role: "user", text: "A soil sensor", client_message_id: CLIENT_ID }] } });
    expect(loggedFailure).toHaveBeenCalledTimes(1);
  });

  it("sendBuildMessage posts with the client_message_id and returns gateway's copy of the message", async () => {
    const message = { id: "msg_3", role: "user", text: "One bed", created_at: AT, client_message_id: CLIENT_ID };
    const client = { get: vi.fn(), mutate: vi.fn().mockResolvedValue({ message }), credentialChange: vi.fn() };
    vi.mocked(sessionClient).mockResolvedValue(client as never);

    await expect(sendBuildMessage("bld_1", "One bed", CLIENT_ID)).resolves.toEqual({ ok: true, data: { message } });
    expect(client.mutate).toHaveBeenCalledWith("POST", "/v1/builds/bld_1/messages", expect.anything(), { text: "One bed", client_message_id: CLIENT_ID });
    expect(client.get).not.toHaveBeenCalled();
  });

  it("refreshBuild reads the build and its messages; a failure is logged and says so", async () => {
    const { build_id: _unused, ...detail } = CREATED;
    const client = { get: vi.fn(async (path: string) => (path.endsWith("/messages") ? { messages: [ASK] } : detail)), mutate: vi.fn(), credentialChange: vi.fn() };
    vi.mocked(sessionClient).mockResolvedValue(client as never);
    await expect(refreshBuild("bld_1")).resolves.toMatchObject({ ok: true, data: { buildId: "bld_1", messages: [ASK], status: "asking" } });
    expect(client.mutate).not.toHaveBeenCalled();

    client.get.mockRejectedValue(new TypeError("fetch failed"));
    await expect(refreshBuild("bld_1")).resolves.toEqual({ ok: false, message: "failure" });
    expect(loggedFailure).toHaveBeenCalledTimes(1);
  });
});

it("forwards an explicit sensor channel/window through the server action", async () => {
  const scope = { channel: "temperature_c", from: "2026-09-13T10:00:00Z", to: "2026-09-13T11:00:00Z" };
  const message = { id: "answer", role: "assistant", text: "20 C", created_at: scope.to };
  vi.mocked(apiPost).mockResolvedValue({ message, queries: [] });
  expect(await askDevice("sensor", "Mean?", scope)).toEqual({ ok: true, data: message });
  expect(apiPost).toHaveBeenCalledWith("/v1/devices/sensor/ask", expect.anything(), { text: "Mean?", ...scope });
});

it("requires an explicit rendered workspace intent before attempting build creation", async () => {
  await expect(startBuild("A soil sensor", CLIENT_ID)).resolves.toMatchObject({ ok: false, message: "Reload to confirm your workspace before starting a build." });
});
