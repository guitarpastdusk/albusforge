import { describe, expect, it, vi } from "vitest";
import { EmailError, logEmailSender, RESEND_ENDPOINT, resendEmailSender, signInCodeMessage } from "./email";
import { createLogger } from "./log";

const message = { to: "ann@example.com", code: "012345", validForMinutes: 10 };

describe("resendEmailSender", () => {
  it("posts the code to Resend with the API key, from address and recipient", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const sender = resendEmailSender({ apiKey: "re_key", from: "Albusforge <sign-in@auth.albusforge.ai>", fetch: fetchImpl as unknown as typeof fetch });
    await sender.sendSignInCode(message);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_key");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      from: "Albusforge <sign-in@auth.albusforge.ai>",
      to: ["ann@example.com"],
      subject: "012345 is your Albusforge sign-in code",
      text: expect.stringContaining("012345"),
    });
    expect(body.text).toContain("10 minutes");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails on a non-2xx answer with the status, and on a network error with the cause", async () => {
    const refused = resendEmailSender({ apiKey: "k", from: "a@b.c", fetch: (async () => new Response("nope", { status: 422 })) as typeof fetch });
    await expect(refused.sendSignInCode(message)).rejects.toMatchObject({ name: "EmailError", status: 422 });

    const cause = new TypeError("fetch failed");
    const down = resendEmailSender({ apiKey: "k", from: "a@b.c", fetch: (async () => Promise.reject(cause)) as typeof fetch });
    const error = await down.sendSignInCode(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailError);
    expect((error as EmailError).cause).toBe(cause);
    expect((error as EmailError).message).not.toContain("ann@");
  });
});

describe("logEmailSender", () => {
  it("writes the recipient and code to the log", async () => {
    const lines: string[] = [];
    await logEmailSender(createLogger({ write: (line) => lines.push(line) })).sendSignInCode(message);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ severity: "INFO", to: "ann@example.com", code: "012345" });
  });
});

describe("signInCodeMessage", () => {
  it("puts the code in the subject and body", () => {
    const { subject, text } = signInCodeMessage({ code: "999999", validForMinutes: 10 });
    expect(subject).toContain("999999");
    expect(text).toContain("999999");
    expect(text).toContain("works once");
  });
});
