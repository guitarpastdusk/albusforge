import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { GatewayError } from "./api/core";
import { reportRequestError, resetRequestErrorLoggingForTests, routeConsoleCall, routeConsoleToStructuredLog } from "./request-errors";

const TRACE = "0123456789abcdef0123456789abcdef";

const request = {
  path: "/projects?tab=all",
  method: "GET",
  headers: { "x-cloud-trace-context": `${TRACE}/1;o=1`, cookie: "__Host-albus_session=secret" },
};

const context = {
  routerKind: "App Router",
  routePath: "/(app)/projects",
  routeType: "render",
  renderSource: "react-server-components",
  revalidateReason: undefined,
} as const;

let write: MockInstance<typeof process.stdout.write>;
const lines = () => write.mock.calls.map(([chunk]) => JSON.parse(String(chunk)) as Record<string, unknown>);

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

const gatewayFailure = () =>
  Object.assign(new GatewayError({ route: "GET /v1/me", status: 200, contentType: "text/html", reason: "not_json" }), {
    digest: "2408655454",
  });

describe("reportRequestError", () => {
  it("writes one ERROR entry with the request, route, digest, trace and single-field stack", async () => {
    await reportRequestError(gatewayFailure(), request, context);

    expect(write).toHaveBeenCalledTimes(1);
    const [entry] = lines();
    expect(entry).toMatchObject({
      severity: "ERROR",
      message: "GET /projects failed: GET /v1/me returned 200 text/html, expected application/json",
      digest: "2408655454",
      request: { method: "GET", path: "/projects?tab=all" },
      next: { routePath: "/(app)/projects", routeType: "render", routerKind: "App Router" },
      error: { name: "GatewayError", gateway: { reason: "not_json", status: 200 } },
      "logging.googleapis.com/trace": `projects/albusforge-staging/traces/${TRACE}`,
      "logging.googleapis.com/spanId": "0000000000000001",
    });
    expect(typeof entry!.stack).toBe("string");
    expect(JSON.stringify(entry)).not.toContain("secret");
  });

  it("logs the same digest only once", async () => {
    const error = gatewayFailure();
    await reportRequestError(error, request, context);
    await reportRequestError(error, request, context);
    expect(write).toHaveBeenCalledTimes(1);
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

  it("console print then onRequestError for the same digest: one entry, the request's", async () => {
    const error = gatewayFailure();
    routeConsoleCall("ERROR", ["⨯", error]);
    expect(write).not.toHaveBeenCalled();

    await reportRequestError(error, request, context);
    vi.advanceTimersByTime(10_000);

    expect(write).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toHaveProperty("request");
  });

  it("onRequestError then console print for the same digest: one entry", async () => {
    const error = gatewayFailure();
    await reportRequestError(error, request, context);
    routeConsoleCall("ERROR", [error]);
    vi.advanceTimersByTime(10_000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("a digest error that never reaches onRequestError is still logged, once", () => {
    const error = gatewayFailure();
    routeConsoleCall("ERROR", [error]);
    routeConsoleCall("ERROR", [error]);
    vi.advanceTimersByTime(2_000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toMatchObject({ severity: "ERROR", digest: "2408655454" });
  });
});
