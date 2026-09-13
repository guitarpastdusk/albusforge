import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";
import { validateRuntimeConfigOrExit } from "./lib/startup";

class Exited extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

const throwingExit = (code: number): never => {
  throw new Exited(code);
};

describe("validateRuntimeConfigOrExit", () => {
  it("logs and exits 1 when API_MODE=mock on Cloud Run", () => {
    const log = vi.fn();
    expect(() => validateRuntimeConfigOrExit({ API_MODE: "mock", K_SERVICE: "web" }, throwingExit, log)).toThrow(
      new Exited(1),
    );
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Refusing to start: API_MODE=mock is not allowed on Cloud Run/));
  });

  it("logs and exits 1 on an invalid TRUSTED_PROXY_HOPS", () => {
    const log = vi.fn();
    expect(() => validateRuntimeConfigOrExit({ TRUSTED_PROXY_HOPS: "abc" }, throwingExit, log)).toThrow(new Exited(1));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/TRUSTED_PROXY_HOPS/));
  });

  it("returns the config and never exits when it is valid", () => {
    const exit = vi.fn(throwingExit);
    expect(validateRuntimeConfigOrExit({ K_SERVICE: "web" }, exit)).toEqual({ apiMode: "live", trustedProxyHops: 1 });
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("instrumentation register()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exits the process when API_MODE=mock on Cloud Run", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("API_MODE", "mock");
    vi.stubEnv("K_SERVICE", "web");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(throwingExit as typeof process.exit);

    await expect(register()).rejects.toThrow(new Exited(1));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("starts with the defaults on Cloud Run", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("API_MODE", "");
    vi.stubEnv("K_SERVICE", "web");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "");
    const exit = vi.spyOn(process, "exit").mockImplementation(throwingExit as typeof process.exit);

    await expect(register()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("API_MODE", "mock");
    vi.stubEnv("K_SERVICE", "web");
    await expect(register()).resolves.toBeUndefined();
  });
});
