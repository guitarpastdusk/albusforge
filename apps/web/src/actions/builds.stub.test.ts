import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTransport } from "@/lib/api/core";
import { gatewayHeaders } from "@/lib/api/gateway-headers.server";
import { createSessionClient } from "@/lib/api/session-client";

/*
 * The build actions against a local HTTP gateway that holds transcript reads
 * open past the reply deadline. The deadline is shortened to BUDGET_MS.
 */

const BUDGET_MS = 300;

vi.mock("@/lib/api/server", () => ({ sessionClient: vi.fn() }));
vi.mock("@/lib/action-errors", () => ({
  actionFailure: vi.fn(async (_action: string, _error: unknown, message = "We can’t reach the service right now.") => ({ ok: false, message })),
}));
vi.mock("@/lib/build-transcript", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/build-transcript")>();
  return {
    ...original,
    waitForReply: (...[read, since, options]: Parameters<typeof original.waitForReply>) =>
      original.waitForReply(read, since, { ...options, timeoutMs: BUDGET_MS }),
  };
});

const { ApiRequestError } = await import("@/lib/api/core");
const { ReplyDeadlineError } = await import("@/lib/build-transcript");
const { sessionClient } = await import("@/lib/api/server");
const { actionFailure } = await import("@/lib/action-errors");
const { checkForReply, sendBuildMessage, startBuild } = await import("./builds");

const AT = "2026-09-13T12:00:00Z";
const EARLIER = [
  { id: "m1", role: "user", text: "A sensor", created_at: AT },
  { id: "m2", role: "assistant", text: "Two questions", created_at: AT },
];

type Hold = "none" | "headers" | "body" | "error";
let hold: Hold = "none";
/** When true, GET /v1/builds/b1 (the sibling of the messages read) answers 503. */
let detailFails = false;
/** Reads of /messages answered normally before holding (sendBuildMessage's read before sending). */
let freeReads = 0;
let messages = [...EARLIER];
const log: Array<{ method: string; path: string }> = [];
const closes: Promise<void>[] = [];
let server: http.Server;
let base = "";

const json = (res: http.ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    log.push({ method: req.method ?? "", path });
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method === "POST" && path === "/v1/builds") {
        messages = [{ id: "m1", role: "user", text: JSON.parse(body).ask_text, created_at: AT }];
        return json(res, 201, { build_id: "b1", status: "designing" });
      }
      if (req.method === "POST" && path === "/v1/builds/b1/messages") return json(res, 202);
      if (req.method === "GET" && path === "/v1/builds/b1") {
        if (detailFails) {
          // Answer after the sibling messages request is already held open.
          return void setTimeout(() => json(res, 503, { error: { code: "unavailable", message: "detail down" } }), 30);
        }
        return json(res, 200, { id: "b1", name: "Build", description: "", display_status: "designing", device_count: 0, updated_at: AT, ready: null });
      }
      if (req.method === "GET" && path === "/v1/builds/b1/messages") {
        if (freeReads > 0 || hold === "none") {
          freeReads = Math.max(0, freeReads - 1);
          return json(res, 200, { messages });
        }
        if (hold === "error") return json(res, 503, { error: { code: "unavailable", message: "try later" } });
        closes.push(new Promise((resolve) => res.on("close", () => resolve())));
        if (hold === "body") {
          res.writeHead(200, { "content-type": "application/json" });
          res.write('{"messages":[');
        }
        return; // held open
      }
      json(res, 404, { error: { code: "not_found", message: path } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
);

beforeEach(() => {
  hold = "none";
  detailFails = false;
  freeReads = 0;
  messages = [...EARLIER];
  log.length = 0;
  closes.length = 0;
  vi.mocked(actionFailure).mockClear();
  vi.mocked(sessionClient).mockImplementation(async () =>
    createSessionClient({
      transportFor: (cookie) => fetchTransport(base, gatewayHeaders({ host: "albusforge.ai", forwardedFor: null, cookie }, null, 1)),
      cookieHeader: "__Host-albus_anon=anon-1",
      writer: { set: vi.fn(), delete: vi.fn() },
    }),
  );
});

async function timed<T>(call: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = performance.now();
  const result = await call();
  return { result, ms: performance.now() - started };
}

const posts = () => log.filter((r) => r.method === "POST").length;

describe("build actions when gateway holds the transcript read open", () => {
  it("startBuild: the first read hangs before headers → check-again with the accepted build, within the budget", async () => {
    hold = "headers";
    const { result, ms } = await timed(() => startBuild("A soil sensor"));

    expect(ms).toBeGreaterThanOrEqual(BUDGET_MS - 20);
    expect(ms).toBeLessThan(BUDGET_MS + 400);
    expect(result).toMatchObject({
      ok: false,
      message: "Your message was sent, but the reply is taking longer than usual.",
      awaitingReply: { buildId: "b1", ready: null, messages: [{ role: "user", text: "A soil sensor" }] },
    });
    expect(actionFailure).not.toHaveBeenCalled();
    expect(posts()).toBe(1);
    // The held request was actually cancelled, not left open.
    await Promise.all(closes);
  });

  it("sendBuildMessage: a read hangs mid-body → check-again with the sent message kept, within the budget", async () => {
    hold = "body";
    freeReads = 1;
    const { result, ms } = await timed(() => sendBuildMessage("b1", "One bed"));

    expect(ms).toBeLessThan(BUDGET_MS + 400);
    expect(result).toMatchObject({ ok: false, awaitingReply: { buildId: "b1" } });
    const shown = (result as { awaitingReply: { messages: Array<{ role: string; text: string }> } }).awaitingReply.messages;
    expect(shown.map((m) => [m.role, m.text])).toEqual([
      ["user", "A sensor"],
      ["assistant", "Two questions"],
      ["user", "One bed"],
    ]);
    expect(actionFailure).not.toHaveBeenCalled();
    expect(posts()).toBe(1);
    await Promise.all(closes);
  });

  it("after a timeout, checking again works normally once gateway answers", async () => {
    hold = "headers";
    await startBuild("A soil sensor");

    hold = "none";
    messages = [...messages, { id: "m2", role: "assistant", text: "Good brief.", created_at: AT }];
    const { result, ms } = await timed(() => checkForReply("b1", 0));
    expect(result).toMatchObject({ ok: true, data: { buildId: "b1" } });
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(posts()).toBe(1);
  });

  it("checkForReply that hangs again stays in check-again without resending", async () => {
    hold = "body";
    const { result, ms } = await timed(() => checkForReply("b1", 1));
    expect(ms).toBeLessThan(BUDGET_MS + 400);
    expect(result).toEqual({ ok: false, message: "Your message was sent, but the reply is taking longer than usual." });
    expect(actionFailure).not.toHaveBeenCalled();
    expect(posts()).toBe(0);
  });

  it("a real read failure after the message was accepted is logged once, and still offers check-again, not resend", async () => {
    hold = "error";
    freeReads = 1;
    const result = await sendBuildMessage("b1", "One bed");
    expect(actionFailure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(actionFailure).mock.calls[0]![0]).toBe("sendBuildMessage");
    expect(result).toMatchObject({ ok: false, message: "Your message was sent, but we couldn’t load the reply.", awaitingReply: { buildId: "b1" } });
  });
});

describe("one transcript GET fails while its sibling is held open", () => {
  it.each(["headers", "body"] as const)("the 503 is the error logged once, and the sibling held at %s is cancelled promptly", async (held) => {
    hold = held;
    detailFails = true;
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { result, ms } = await timed(() => checkForReply("b1", 0));

      // Well before the deadline: this is a real failure, not a timeout.
      expect(ms).toBeLessThan(BUDGET_MS - 100);
      expect(result).toEqual({ ok: false, message: "Your message was sent, but we couldn’t load the reply." });
      expect(actionFailure).toHaveBeenCalledTimes(1);
      const [action, error] = vi.mocked(actionFailure).mock.calls[0]!;
      expect(action).toBe("checkForReply");
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({ status: 503 });
      expect(error).not.toBeInstanceOf(ReplyDeadlineError);

      // The held messages request was seen by the server and its connection closed, well within the budget.
      expect(closes).toHaveLength(1);
      const started = performance.now();
      await closes[0];
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);

      await new Promise((resolve) => setTimeout(resolve, BUDGET_MS + 50));
      expect(actionFailure).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("sendBuildMessage after acceptance: same single 503 log, check-again kept, sibling cancelled", async () => {
    hold = "body";
    detailFails = true;
    freeReads = 1;
    const result = await sendBuildMessage("b1", "One bed");
    expect(result).toMatchObject({ ok: false, awaitingReply: { buildId: "b1" } });
    expect(actionFailure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(actionFailure).mock.calls[0]![1]).toMatchObject({ status: 503 });
    expect(posts()).toBe(1);
    await closes[0];
  });
});
