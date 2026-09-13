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
const { checkForReply, sendBuildMessage, startBuild } = await import("./builds");
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

  it.each(NON_STRINGS)("startBuild(%j) returns the validation result", async (input) => {
    await expect(startBuild(input)).resolves.toMatchObject({ ok: false, message: "Describe the device you want to start." });
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it.each([
    [null, "hi"],
    [42, "hi"],
    ["bld_1", null],
    ["bld_1", { text: "hi" }],
  ])("sendBuildMessage(%j, %j) returns the validation result", async (id, text) => {
    await expect(sendBuildMessage(id, text)).resolves.toMatchObject({ ok: false, message: "Write a reply to send." });
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it.each([
    ["bld_1", "3"],
    ["bld_1", -1],
    ["bld_1", 1.5],
    [{}, 0],
  ])("checkForReply(%j, %j) returns the validation result", async (id, since) => {
    await expect(checkForReply(id, since)).resolves.toMatchObject({ ok: false });
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

describe("a turn gateway refuses before accepting it", () => {
  const refusingClient = (error: Error) => ({
    get: vi.fn().mockResolvedValue({ messages: [] }),
    mutate: vi.fn().mockRejectedValue(error),
    credentialChange: vi.fn(),
  });

  it.each([
    ["409 TURN_IN_PROGRESS", new GatewayRefusal(409, "TURN_IN_PROGRESS", "a reply is still being written"), /^Still working on the last reply\. Your message wasn’t sent/],
    ["429 RATE_LIMITED", new GatewayRefusal(429, "RATE_LIMITED", "slow down"), /Your message wasn’t sent: wait a moment/],
  ])("%s: says the message wasn't sent (so the draft comes back), with no check-again, and logs nothing", async (_label, error, message) => {
    vi.mocked(loggedFailure).mockClear();
    vi.mocked(sessionClient).mockResolvedValue(refusingClient(error) as never);
    for (const result of [await sendBuildMessage("bld_1", "One more bed"), await startBuild("A soil sensor")]) {
      expect(result).toEqual({ ok: false, message: expect.stringMatching(message) });
    }
    expect(loggedFailure).not.toHaveBeenCalled();
  });

  it("any other 409 is still a logged failure", async () => {
    vi.mocked(loggedFailure).mockClear();
    vi.mocked(sessionClient).mockResolvedValue(refusingClient(new GatewayRefusal(409, "conflict", "something else")) as never);
    await expect(sendBuildMessage("bld_1", "hi")).resolves.toEqual({ ok: false, message: "failure" });
    expect(loggedFailure).toHaveBeenCalledTimes(1);
  });
});
