import { describe, expect, it } from "vitest";
import { buildApp, type AppOptions } from "./app";
import { createLogger } from "./log";

const BUILD = "00000000-0000-4000-8000-000000000001";
const MESSAGE = "00000000-0000-4000-8000-0000000000aa";

function app(overrides: Partial<AppOptions> = {}, lines: string[] = []) {
  return buildApp({
    turns: async () => ({ message_id: MESSAGE, spec_version: 1, status: "asking" }),
    ping: async () => {},
    log: createLogger({ write: (l) => lines.push(l), project: undefined }),
    ...overrides,
  });
}

const post = (instance: ReturnType<typeof app>, payload: unknown) =>
  instance.inject({ method: "POST", url: "/v1/turns", payload: payload as object, headers: { "content-type": "application/json" } });

describe("intake HTTP", () => {
  it("/healthz never touches the database; /readyz does", async () => {
    const failing = app({ ping: async () => Promise.reject(new Error("down")) });
    expect((await failing.inject("/healthz")).statusCode).toBe(200);
    const ready = await failing.inject("/readyz");
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ error: { code: "UNAVAILABLE", message: "Database unavailable" } });
    expect((await app().inject("/readyz")).statusCode).toBe(200);
  });

  it("POST /v1/turns answers the turn contract", async () => {
    const seen: string[] = [];
    const instance = app({
      turns: async (id, trace) => {
        seen.push(`${id} ${trace?.traceId}`);
        return { message_id: MESSAGE, spec_version: 2, status: "planning" };
      },
    });
    const response = await instance.inject({
      method: "POST",
      url: "/v1/turns",
      payload: { build_id: BUILD },
      headers: { "x-cloud-trace-context": "0123456789abcdef0123456789abcdef/1;o=1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message_id: MESSAGE, spec_version: 2, status: "planning" });
    expect(seen).toEqual([`${BUILD} 0123456789abcdef0123456789abcdef`]);
  });

  it("noop is a 200 too", async () => {
    const response = await post(app({ turns: async () => ({ noop: true }) }), { build_id: BUILD });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ noop: true });
  });

  it("rejects a body without a uuid build_id, and 404s an unknown build", async () => {
    expect((await post(app(), { build_id: "nope" })).statusCode).toBe(400);
    expect((await post(app(), {})).json().error.code).toBe("BAD_REQUEST");
    const missing = await post(app({ turns: async () => null }), { build_id: BUILD });
    expect(missing.statusCode).toBe(404);
  });

  it("a database outage is a 503; any other failure a 500 carrying only the request id", async () => {
    const outage = await post(app({ turns: async () => Promise.reject(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })) }), { build_id: BUILD });
    expect(outage.statusCode).toBe(503);
    const lines: string[] = [];
    const crash = await post(app({ turns: async () => Promise.reject(new Error("secret detail")) }, lines), { build_id: BUILD });
    expect(crash.statusCode).toBe(500);
    expect(crash.body).not.toContain("secret detail");
    expect(lines.some((l) => l.includes('"request failed"'))).toBe(true);
  });

  it("unknown paths are a JSON 404", async () => {
    const response = await app().inject("/nope");
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });
});
