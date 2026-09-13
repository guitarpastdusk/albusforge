import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { onRequestError, register } from "./instrumentation";
import { resetRequestErrorLoggingForTests } from "./lib/request-errors";
import { validateRuntimeConfigOrExit } from "./lib/startup";

class Exited extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

const throwingExit = (code: number): never => {
  throw new Exited(code);
};

let write: MockInstance<typeof process.stdout.write>;
const lines = () => write.mock.calls.map(([chunk]) => JSON.parse(String(chunk)) as Record<string, unknown>);

beforeEach(() => {
  write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  resetRequestErrorLoggingForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("validateRuntimeConfigOrExit", () => {
  it("logs and exits 1 when API_MODE=mock on Cloud Run", () => {
    const log = vi.fn();
    expect(() => validateRuntimeConfigOrExit({ API_MODE: "mock", K_SERVICE: "web" }, throwingExit, log)).toThrow(
      new Exited(1),
    );
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Refusing to start: API_MODE=mock is not allowed on Cloud Run/));
  });

  it("logs the refusal as a CRITICAL structured entry by default", () => {
    expect(() => validateRuntimeConfigOrExit({ TRUSTED_PROXY_HOPS: "abc" }, throwingExit)).toThrow(new Exited(1));
    expect(lines()).toEqual([expect.objectContaining({ severity: "CRITICAL", message: expect.stringMatching(/TRUSTED_PROXY_HOPS/) })]);
  });

  it("returns the config and never exits when it is valid", () => {
    const exit = vi.fn(throwingExit);
    expect(validateRuntimeConfigOrExit({ K_SERVICE: "web" }, exit)).toEqual({ apiMode: "live", trustedProxyHops: 1 });
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("instrumentation register()", () => {
  it("exits the process when API_MODE=mock on Cloud Run", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("API_MODE", "mock");
    vi.stubEnv("K_SERVICE", "web");
    const exit = vi.spyOn(process, "exit").mockImplementation(throwingExit as typeof process.exit);

    await expect(register()).rejects.toThrow(new Exited(1));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("starts with the defaults on Cloud Run and routes console.error to one JSON line", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("API_MODE", "");
    vi.stubEnv("K_SERVICE", "web");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "");
    const exit = vi.spyOn(process, "exit").mockImplementation(throwingExit as typeof process.exit);

    await expect(register()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();

    console.error("plain failure");
    expect(lines()).toEqual([expect.objectContaining({ severity: "ERROR", message: "plain failure" })]);
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("API_MODE", "mock");
    vi.stubEnv("K_SERVICE", "web");
    await expect(register()).resolves.toBeUndefined();
  });
});

describe("instrumentation onRequestError()", () => {
  it("reports a failed request as one ERROR entry", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await onRequestError(
      Object.assign(new Error("boom"), { digest: "1" }),
      { path: "/live", method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/(app)/live", routeType: "render", revalidateReason: undefined },
    );
    expect(lines()).toEqual([expect.objectContaining({ severity: "ERROR", message: "GET /live failed: boom", digest: "1" })]);
  });
});
