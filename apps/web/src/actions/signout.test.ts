import { SESSION_COOKIE } from "@albusforge/schema";
import { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api/core";
import type { SessionClient } from "@/lib/api/session-client";

/** The response's Set-Cookie headers, through Next's real cookie store. */
let responseHeaders = new Headers();

vi.mock("next/headers", () => ({ cookies: async () => new ResponseCookies(responseHeaders) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));
vi.mock("@/lib/api/server", () => ({ sessionClient: vi.fn() }));
vi.mock("@/lib/action-errors", () => ({
  actionFailure: vi.fn(async () => ({ ok: false, message: "failed" })),
  actionIncomplete: vi.fn(),
}));

const { redirect } = await import("next/navigation");
const { sessionClient } = await import("@/lib/api/server");
const { actionFailure } = await import("@/lib/action-errors");
const { signOut } = await import("./auth");

const client = (mutate: ReturnType<typeof vi.fn>) => ({ get: vi.fn(), mutate, credentialChange: vi.fn() }) as unknown as SessionClient;

const sessionLine = () => responseHeaders.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`));

beforeEach(() => {
  responseHeaders = new Headers();
  vi.mocked(redirect).mockClear();
  vi.mocked(actionFailure).mockClear();
});

describe("signOut", () => {
  it("calls POST /v1/auth/signout, deletes the session cookie with Secure and Path=/, and redirects home", async () => {
    const mutate = vi.fn().mockResolvedValue(null);
    vi.mocked(sessionClient).mockResolvedValue(client(mutate));

    await expect(signOut()).rejects.toMatchObject({ url: "/" });

    expect(mutate).toHaveBeenCalledWith("POST", "/v1/auth/signout", expect.anything());
    const line = sessionLine();
    expect(line).toMatch(/^__Host-albus_session=;/);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(line).toMatch(/Secure/);
    expect(line).not.toMatch(/Domain/i);
    expect(actionFailure).not.toHaveBeenCalled();
  });

  it("still signs the browser out when gateway fails, logging the failure once", async () => {
    const failure = new ApiRequestError(503, "unavailable", "down");
    vi.mocked(sessionClient).mockResolvedValue(client(vi.fn().mockRejectedValue(failure)));

    await expect(signOut()).rejects.toMatchObject({ url: "/" });

    expect(actionFailure).toHaveBeenCalledTimes(1);
    expect(actionFailure).toHaveBeenCalledWith("signOut", failure);
    expect(sessionLine()).toMatch(/^__Host-albus_session=;.*Secure/);
  });
});
