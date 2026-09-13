import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { GatewayError } from "./api/core";
import {
  createRequestErrorLogger,
  reportRequestError,
  resetRequestErrorLoggingForTests,
  routeConsoleCall,
  routeConsoleToStructuredLog,
} from "./request-errors";

const TRACE_A = "0123456789abcdef0123456789abcdef";
const TRACE_B = "fedcba9876543210fedcba9876543210";
const TRACE_C = "11111111111111111111111111111111";
const traceField = (trace: string) => `projects/albusforge-staging/traces/${trace}`;

const requestWithTrace = (trace: string, path = "/projects") => ({
  path,
  method: "GET",
  headers: { "x-cloud-trace-context": `${trace}/1;o=1`, cookie: "__Host-albus_session=secret" },
});

const context = {
  routerKind: "App Router",
  routePath: "/(app)/projects",
  routeType: "render",
  renderSource: "react-server-components",
  revalidateReason: undefined,
} as const;

let write: MockInstance<typeof process.stdout.write>;
const lines = () => write.mock.calls.map(([chunk]) => JSON.parse(String(chunk)) as Record<string, unknown>);
const errorLines = () => lines().filter((entry) => entry.severity === "ERROR");

/** A fresh error object per request, as Next has; the digest is the same for the same failure. */
const gatewayFailure = (digest = "2408655454") =>
  Object.assign(new GatewayError({ route: "GET /v1/builds", status: 200, contentType: "text/html", reason: "not_json" }), {
    digest,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "albusforge-staging");
  write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  resetRequestErrorLoggingForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("reportRequestError", () => {
  it("writes one ERROR entry with the request, route, digest, trace and single-field stack", async () => {
    await reportRequestError(gatewayFailure(), requestWithTrace(TRACE_A, "/projects?tab=all"), context);

    expect(write).toHaveBeenCalledTimes(1);
    const [entry] = lines();
    expect(entry).toMatchObject({
      severity: "ERROR",
      message: "GET /projects failed: GET /v1/builds returned 200 text/html, expected application/json",
      digest: "2408655454",
      request: { method: "GET", path: "/projects?tab=all" },
      next: { routePath: "/(app)/projects", routeType: "render", routerKind: "App Router" },
      error: { name: "GatewayError", gateway: { reason: "not_json", status: 200 } },
      "logging.googleapis.com/trace": traceField(TRACE_A),
      "logging.googleapis.com/spanId": "0000000000000001",
    });
    expect(typeof entry!.stack).toBe("string");
    expect(JSON.stringify(entry)).not.toContain("secret");
  });

  it("logs one thrown object once, even if Next reports it twice for the same request", async () => {
    const error = gatewayFailure();
    await reportRequestError(error, requestWithTrace(TRACE_A), context);
    await reportRequestError(error, requestWithTrace(TRACE_A), context);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("an error object shared by two requests (a memoised rejected promise) gives each request its own entry", async () => {
    const shared = gatewayFailure();
    await reportRequestError(shared, requestWithTrace(TRACE_A), context);
    await reportRequestError(shared, requestWithTrace(TRACE_B), context);
    await reportRequestError(shared, requestWithTrace(TRACE_A), context);

    expect(errorLines().map((entry) => entry["logging.googleapis.com/trace"])).toEqual([
      traceField(TRACE_A),
      traceField(TRACE_B),
    ]);
  });

  it("without a trace ID, a repeated object is logged again rather than dropped", async () => {
    const error = gatewayFailure();
    const untraced = { path: "/projects", method: "GET", headers: {} };
    await reportRequestError(error, untraced, context);
    await reportRequestError(error, untraced, context);
    expect(errorLines()).toHaveLength(2);
  });

  it("an object shared by more requests than the per-object bound still logs every request", async () => {
    const shared = gatewayFailure();
    const traces = Array.from({ length: 1_001 }, (_, i) => (i + 1).toString(16).padStart(32, "0"));
    for (const trace of traces) await reportRequestError(shared, requestWithTrace(trace), context);
    expect(errorLines()).toHaveLength(1_001);
  });

  it("regression: two requests with the same digest and different traces give two entries, each with its own trace", async () => {
    await reportRequestError(gatewayFailure(), requestWithTrace(TRACE_A), context);
    await reportRequestError(gatewayFailure(), requestWithTrace(TRACE_B), context);

    expect(errorLines().map((entry) => entry["logging.googleapis.com/trace"])).toEqual([
      traceField(TRACE_A),
      traceField(TRACE_B),
    ]);
  });

  it("regression, with Next's console copies interleaved: still two entries with their own traces", async () => {
    const first = gatewayFailure();
    const second = gatewayFailure();
    routeConsoleCall("ERROR", ["⨯", first]);
    await reportRequestError(first, requestWithTrace(TRACE_A), context);
    routeConsoleCall("ERROR", ["⨯", second]);
    await reportRequestError(second, requestWithTrace(TRACE_B), context);
    vi.advanceTimersByTime(10_000);

    expect(errorLines().map((entry) => entry["logging.googleapis.com/trace"])).toEqual([
      traceField(TRACE_A),
      traceField(TRACE_B),
    ]);
  });
});

describe("1:1 pairing with Next's console copy", () => {
  it("console copy first, then onRequestError: one entry, the request's", async () => {
    const error = gatewayFailure();
    routeConsoleCall("ERROR", ["⨯", error]);
    expect(write).not.toHaveBeenCalled();

    await reportRequestError(error, requestWithTrace(TRACE_A), context);
    vi.advanceTimersByTime(10_000);

    expect(write).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toMatchObject({ request: { path: "/projects" }, "logging.googleapis.com/trace": traceField(TRACE_A) });
  });

  it("onRequestError first, then the console copy: one entry", async () => {
    const error = gatewayFailure();
    await reportRequestError(error, requestWithTrace(TRACE_A), context);
    routeConsoleCall("ERROR", [error]);
    vi.advanceTimersByTime(10_000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("three concurrent same-digest failures, copies and hooks interleaved: three entries, three traces", async () => {
    const failures = [gatewayFailure(), gatewayFailure(), gatewayFailure()];
    for (const failure of failures) routeConsoleCall("ERROR", ["⨯", failure]);
    await reportRequestError(failures[1]!, requestWithTrace(TRACE_B), context);
    await reportRequestError(failures[0]!, requestWithTrace(TRACE_A), context);
    await reportRequestError(failures[2]!, requestWithTrace(TRACE_C), context);
    vi.advanceTimersByTime(10_000);

    expect(write).toHaveBeenCalledTimes(3);
    expect(new Set(errorLines().map((entry) => entry["logging.googleapis.com/trace"]))).toEqual(
      new Set([traceField(TRACE_A), traceField(TRACE_B), traceField(TRACE_C)]),
    );
  });

  it("an unmatched console copy is still emitted, once, after the hold", () => {
    routeConsoleCall("ERROR", [gatewayFailure()]);
    vi.advanceTimersByTime(1_999);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(write).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toMatchObject({ severity: "ERROR", digest: "2408655454" });
    expect(lines()[0]).not.toHaveProperty("logging.googleapis.com/trace");
  });

  it("each onRequestError cancels at most one console copy", async () => {
    const error = gatewayFailure();
    routeConsoleCall("ERROR", [error]);
    routeConsoleCall("ERROR", [gatewayFailure()]);
    await reportRequestError(error, requestWithTrace(TRACE_A), context);
    vi.advanceTimersByTime(10_000);

    // The request's entry, plus the second copy that no request claimed.
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("an expired credit doesn't cancel a later, unrelated console copy", async () => {
    await reportRequestError(gatewayFailure(), requestWithTrace(TRACE_A), context);
    vi.advanceTimersByTime(2_000);

    routeConsoleCall("ERROR", [gatewayFailure()]);
    vi.advanceTimersByTime(2_000);

    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe("bounded memory", () => {
  it("at the per-digest cap, console copies are emitted immediately, not dropped", () => {
    const logger = createRequestErrorLogger({ maxPerDigest: 2, maxTotal: 100 });
    for (let i = 0; i < 5; i += 1) logger.routeConsoleCall("ERROR", [gatewayFailure()]);

    expect(logger.pendingCount()).toBe(2);
    expect(write).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(2_000);
    expect(write).toHaveBeenCalledTimes(5);
    expect(logger.pendingCount()).toBe(0);
    logger.reset();
  });

  it("at the overall cap, copies for any digest are emitted immediately, and credits stop accruing", async () => {
    const logger = createRequestErrorLogger({ maxPerDigest: 10, maxTotal: 2 });
    logger.routeConsoleCall("ERROR", [gatewayFailure("a")]);
    logger.routeConsoleCall("ERROR", [gatewayFailure("b")]);
    logger.routeConsoleCall("ERROR", [gatewayFailure("c")]);
    expect(write).toHaveBeenCalledTimes(1);

    // No room for a credit: the hook still logs, and its later copy is logged too (a duplicate, not a loss).
    const d = gatewayFailure("d");
    await logger.reportRequestError(d, requestWithTrace(TRACE_A), context);
    logger.routeConsoleCall("ERROR", [d]);
    expect(write).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(2_000);
    expect(write).toHaveBeenCalledTimes(5);
    expect(logger.pendingCount()).toBe(0);
    logger.reset();
  });

  it("expired copies and credits are released", async () => {
    const logger = createRequestErrorLogger();
    logger.routeConsoleCall("ERROR", [gatewayFailure("x")]);
    await logger.reportRequestError(gatewayFailure("y"), requestWithTrace(TRACE_A), context);
    expect(logger.pendingCount()).toBe(2);
    vi.advanceTimersByTime(2_000);
    expect(logger.pendingCount()).toBe(0);
    logger.reset();
  });
});

describe("console routing", () => {
  it("maps console.error to ERROR and console.warn to WARNING, one JSON line each", () => {
    routeConsoleToStructuredLog();
    console.error("something broke:", { code: 7 });
    console.warn("deprecated thing");
    expect(lines().map(({ severity, message }) => ({ severity, message }))).toEqual([
      { severity: "ERROR", message: "something broke: { code: 7 }" },
      { severity: "WARNING", message: "deprecated thing" },
    ]);
  });

  it("strips colour codes and Next's ⨯ marker, and keeps the stack in one field", () => {
    const error = new Error("boom");
    routeConsoleCall("ERROR", [`${String.fromCharCode(27)}[31m⨯${String.fromCharCode(27)}[39m`, error]);
    const [entry] = lines();
    expect(entry).toMatchObject({ severity: "ERROR", message: "Error: boom", stack: error.stack });
  });
});
