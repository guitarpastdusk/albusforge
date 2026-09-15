import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createTurnScheduler, googleIdTokenAuth, httpIntakeClient, IntakeError, isRetryable, withDeadline } from "./intake";
import { createLogger } from "./log";

type Handler = (body: unknown, req: http.IncomingMessage, res: http.ServerResponse) => void;

/** A stand-in for intake's POST /v1/turns. */
async function stubIntake(handler: Handler) {
  const calls: { body: unknown; authorization: string | undefined; path: string | undefined }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "null") as unknown;
      calls.push({ body, authorization: req.headers.authorization, path: req.url });
      handler(body, req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stops.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { url, calls, server };
}

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) {
    await stop();
  }
});

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function capture() {
  const lines: Record<string, unknown>[] = [];
  return { lines, log: createLogger({ write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>) }) };
}

const BUILD = "7a0c1c4e-2f7e-4b1a-9d3e-8f0b1a2c3d4e";

describe("httpIntakeClient", () => {
  it("posts { build_id, may_retry } to /v1/turns with the auth header", async () => {
    const stub = await stubIntake((_body, _req, res) => json(res, 200, { message_id: "m1", spec_version: 2, status: "asking" }));
    const client = httpIntakeClient({ url: `${stub.url}/`, authHeader: async () => "Bearer id-token" });
    await expect(client.turn(BUILD, AbortSignal.timeout(1000))).resolves.toEqual({ message_id: "m1", spec_version: 2, status: "asking" });
    // Defaults to false: a caller that doesn't say it will retry must get an answer.
    expect(stub.calls).toEqual([{ body: { build_id: BUILD, may_retry: false }, authorization: "Bearer id-token", path: "/v1/turns" }]);

    await client.turn(BUILD, AbortSignal.timeout(1000), true);
    expect(stub.calls.at(-1)).toMatchObject({ body: { build_id: BUILD, may_retry: true } });
  });

  it("sends no Authorization with INTAKE_AUTH=none, and accepts a noop", async () => {
    const stub = await stubIntake((_body, _req, res) => json(res, 200, { noop: true }));
    const client = httpIntakeClient({ url: stub.url, authHeader: async () => undefined });
    await expect(client.turn(BUILD, AbortSignal.timeout(1000))).resolves.toEqual({ noop: true });
    expect(stub.calls[0]?.authorization).toBeUndefined();
  });

  it("throws on a non-2xx answer or an unexpected body", async () => {
    const failing = await stubIntake((_body, _req, res) => json(res, 503, { error: "busy" }));
    await expect(httpIntakeClient({ url: failing.url, authHeader: async () => undefined }).turn(BUILD, AbortSignal.timeout(1000))).rejects.toMatchObject({
      name: "IntakeError",
      status: 503,
    });
    const odd = await stubIntake((_body, _req, res) => json(res, 200, { hello: "world" }));
    await expect(httpIntakeClient({ url: odd.url, authHeader: async () => undefined }).turn(BUILD, AbortSignal.timeout(1000))).rejects.toBeInstanceOf(
      IntakeError,
    );
  });
});

describe("googleIdTokenAuth", () => {
  it("creates one ID token client for the audience and reads its Authorization header", async () => {
    const audiences: string[] = [];
    let attempts = 0;
    const auth = {
      getIdTokenClient: async (audience: string) => {
        audiences.push(audience);
        if (attempts++ === 0) throw new Error("metadata server unreachable");
        return { getRequestHeaders: async () => new Headers({ authorization: "Bearer from-metadata" }) } as never;
      },
    };
    const header = googleIdTokenAuth("https://intake-abc.a.run.app", auth);
    await expect(header()).rejects.toThrow("metadata server unreachable");
    await expect(header()).resolves.toBe("Bearer from-metadata");
    await expect(header()).resolves.toBe("Bearer from-metadata");
    expect(audiences).toEqual(["https://intake-abc.a.run.app", "https://intake-abc.a.run.app"]);
  });
});

describe("createTurnScheduler", () => {
  it("logs a completed turn at INFO", async () => {
    const stub = await stubIntake((_body, _req, res) => json(res, 200, { message_id: "m1", spec_version: 1, status: "asking" }));
    const { lines, log } = capture();
    const turns = createTurnScheduler({ intake: httpIntakeClient({ url: stub.url, authHeader: async () => undefined }), log });
    turns.trigger(BUILD, { requestId: "r1" });
    await turns.idle();
    expect(lines).toEqual([expect.objectContaining({ severity: "INFO", message: "intake turn completed", buildId: BUILD, requestId: "r1", messageId: "m1" })]);
  });

  it("retries a 5xx once after the delay, then logs a WARNING and never rejects", async () => {
    const failing = await stubIntake((_body, _req, res) => json(res, 500, {}));
    const { lines, log } = capture();
    const turns = createTurnScheduler({ intake: httpIntakeClient({ url: failing.url, authHeader: async () => undefined }), log, retryDelayMs: 150 });
    const started = Date.now();
    turns.trigger(BUILD);
    await turns.idle();
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    expect(failing.calls).toHaveLength(2);
    expect(lines).toEqual([
      expect.objectContaining({ severity: "WARNING", message: "intake turn attempt failed; retrying", attempt: 1, intakeStatus: 500, retryDelayMs: 150 }),
      expect.objectContaining({ severity: "WARNING", message: "intake turn failed", buildId: BUILD, attempt: 2, intakeStatus: 500 }),
    ]);
  });

  it("completes when the retry succeeds", async () => {
    let calls = 0;
    const flaky = await stubIntake((_body, _req, res) => (calls++ === 0 ? json(res, 503, {}) : json(res, 200, { noop: true })));
    const { lines, log } = capture();
    const turns = createTurnScheduler({ intake: httpIntakeClient({ url: flaky.url, authHeader: async () => undefined }), log, retryDelayMs: 10 });
    turns.trigger(BUILD);
    await turns.idle();
    expect(flaky.calls).toHaveLength(2);
    expect(lines.at(-1)).toMatchObject({ severity: "INFO", message: "intake turn completed", attempt: 2, noop: true });
  });

  it("retries a network error once", async () => {
    const gone = http.createServer();
    await new Promise<void>((resolve) => gone.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(gone.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => gone.close(() => resolve()));
    const { lines, log } = capture();
    const turns = createTurnScheduler({ intake: httpIntakeClient({ url, authHeader: async () => undefined }), log, retryDelayMs: 10 });
    turns.trigger(BUILD);
    await turns.idle();
    expect(lines.map((l) => [l.message, l.attempt])).toEqual([
      ["intake turn attempt failed; retrying", 1],
      ["intake turn failed", 2],
    ]);
  });

  it("doesn't retry a 4xx or a timeout", async () => {
    const rejecting = await stubIntake((_body, _req, res) => json(res, 400, {}));
    // Observe scheduler admission directly: a real fetch can time out before
    // localhost receives it under load, which says nothing about retry count.
    const timeoutSignals: AbortSignal[] = [];
    const { lines, log } = capture();

    const rejected = createTurnScheduler({ intake: httpIntakeClient({ url: rejecting.url, authHeader: async () => undefined }), log, retryDelayMs: 10 });
    rejected.trigger(BUILD);
    await rejected.idle();
    const slow = createTurnScheduler({ intake: { turn: async (_build, signal) => {
      timeoutSignals.push(signal);
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    } }, log, timeoutMs: 100, retryDelayMs: 10 });
    slow.trigger(BUILD);
    await slow.idle();

    expect(rejecting.calls).toHaveLength(1);
    expect(timeoutSignals).toHaveLength(1);
    expect(timeoutSignals[0]!.aborted).toBe(true);
    expect(timeoutSignals[0]!.reason).toMatchObject({ name: "TimeoutError" });
    expect(lines).toEqual([
      expect.objectContaining({ severity: "WARNING", message: "intake turn failed", attempt: 1, intakeStatus: 400 }),
      expect.objectContaining({ severity: "WARNING", message: "intake turn failed", attempt: 1, error: expect.objectContaining({ name: "TimeoutError" }) }),
    ]);
  });

  it("bounds the whole turn, token acquisition included, and frees the build for the next trigger", async () => {
    const stub = await stubIntake((_body, _req, res) => json(res, 200, { noop: true }));
    const { lines, log } = capture();
    let lateToken: (value: string) => void = () => {};
    const stalledAuth = () => new Promise<string>((resolve) => (lateToken = resolve));
    const turns = createTurnScheduler({ intake: httpIntakeClient({ url: stub.url, authHeader: stalledAuth }), log, timeoutMs: 50, retryDelayMs: 10 });

    const started = Date.now();
    turns.trigger(BUILD);
    await turns.idle();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(turns.isRunning(BUILD)).toBe(false);
    expect(lines).toEqual([
      expect.objectContaining({ severity: "WARNING", message: "intake turn failed", attempt: 1, error: expect.objectContaining({ name: "TimeoutError" }) }),
    ]);

    // The token arriving after the deadline goes nowhere: the aborted fetch never reaches intake.
    lateToken("Bearer late");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stub.calls).toHaveLength(0);
  });

  it("drops a late rejection after the deadline", async () => {
    let fail: (error: Error) => void = () => {};
    const work = () => new Promise<never>((_, reject) => (fail = reject));
    await expect(withDeadline(work, 20)).rejects.toMatchObject({ name: "TimeoutError" });
    fail(new Error("too late")); // must not surface as an unhandled rejection
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("classifies retryable errors", () => {
    expect(isRetryable(new IntakeError("x", 502))).toBe(true);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryable(new IntakeError("x", 404))).toBe(false);
    expect(isRetryable(new IntakeError("bad body"))).toBe(false);
    expect(isRetryable(new DOMException("timed out", "TimeoutError"))).toBe(false);
  });

  it("warns when intake isn't configured", async () => {
    const { lines, log } = capture();
    const turns = createTurnScheduler({ intake: null, log });
    turns.trigger(BUILD);
    await turns.idle();
    expect(lines[0]).toMatchObject({ severity: "WARNING", message: "intake turn skipped: INTAKE_URL is not set" });
  });

  it("runs one more turn when triggered again mid-turn, however many triggers arrive", async () => {
    const pending: http.ServerResponse[] = [];
    const stub = await stubIntake((_body, _req, res) => pending.push(res));
    const { log } = capture();
    const turns = createTurnScheduler({ intake: httpIntakeClient({ url: stub.url, authHeader: async () => undefined }), log });

    turns.trigger(BUILD);
    await expect.poll(() => stub.calls.length).toBe(1);
    turns.trigger(BUILD);
    turns.trigger(BUILD);
    json(pending.shift()!, 200, { noop: true });
    await expect.poll(() => stub.calls.length).toBe(2);
    json(pending.shift()!, 200, { noop: true });
    await turns.idle();
    expect(stub.calls).toHaveLength(2);
  });
});
