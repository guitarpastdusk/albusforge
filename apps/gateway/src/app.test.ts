import { ApiError, PartDetail, PartList, type PartDefinition } from "@albusforge/schema";
import { readValidatedParts } from "@albusforge/registry/db-load";
import { REGISTRY_ROOT } from "@albusforge/registry/load";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { createLogger } from "./log";
import { latestPerId, type PartFilter, type PartsStore } from "./parts";

const TRACE = "0123456789abcdef0123456789abcdef";
const registry = readValidatedParts(REGISTRY_ROOT);

/** The store's contract over an in-memory list, for route tests without Postgres. */
function memoryStore(parts: PartDefinition[]): PartsStore & { calls: PartFilter[] } {
  const calls: PartFilter[] = [];
  return {
    calls,
    async latest(filter) {
      calls.push(filter);
      const matching = parts.filter((p) => filter.statuses.includes(p.status) && (filter.id === undefined || p.id === filter.id));
      return latestPerId(matching).filter((p) => filter.category === undefined || p.category === filter.category);
    },
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function setUp(options: { parts?: PartsStore; ping?: () => Promise<void> } = {}) {
  const lines: string[] = [];
  app = buildApp({
    parts: options.parts ?? memoryStore(registry),
    ping: options.ping ?? (async () => {}),
    log: createLogger({ project: "albusforge-staging", write: (line) => lines.push(line) }),
    readyTimeoutMs: 50,
  });
  const logs = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { app, logs, lines };
}

const expectJsonError = (response: { statusCode: number; headers: Record<string, unknown>; json: () => unknown }, status: number, code: string) => {
  expect(response.statusCode).toBe(status);
  expect(String(response.headers["content-type"])).toMatch(/^application\/json/);
  const body = ApiError.parse(response.json());
  expect(body.error.code).toBe(code);
  return body;
};

describe("health", () => {
  it("/healthz is 200 without calling the database", async () => {
    let pinged = false;
    const { app } = setUp({ ping: async () => void (pinged = true) });
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(pinged).toBe(false);
  });

  it("/readyz is 200 when the database answers", async () => {
    const { app } = setUp();
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
  });

  it("/readyz is 503 when the ping fails or hangs", async () => {
    const failing = setUp({ ping: async () => Promise.reject(new Error("ECONNREFUSED")) });
    expectJsonError(await failing.app.inject({ method: "GET", url: "/readyz" }), 503, "UNAVAILABLE");
    await failing.app.close();

    const hanging = setUp({ ping: () => new Promise(() => {}) });
    expectJsonError(await hanging.app.inject({ method: "GET", url: "/readyz" }), 503, "UNAVAILABLE");
    expect(hanging.logs().some((l) => l.message === "readiness check failed")).toBe(true);
  });
});

describe("fallbacks", () => {
  it.each([
    ["GET", "/v1"],
    ["GET", "/v1/builds"],
    ["POST", "/v1/builds"],
    ["GET", "/v1/me"],
    ["POST", "/v1/parts"],
    ["GET", "/v1/parts/P-001/versions"],
  ] as const)("%s %s is a JSON 501", async (method, url) => {
    const { app } = setUp();
    expectJsonError(await app.inject({ method, url }), 501, "NOT_IMPLEMENTED");
  });

  it.each(["/", "/nope", "/v10/parts", "/healthz/extra"])("%s is a JSON 404", async (url) => {
    const { app } = setUp();
    expectJsonError(await app.inject({ method: "GET", url }), 404, "NOT_FOUND");
  });
});

describe("GET /v1/parts", () => {
  it("lists every non-retired part by default, validated against the schema", async () => {
    const store = memoryStore(registry);
    const { app } = setUp({ parts: store });
    const response = await app.inject({ method: "GET", url: "/v1/parts" });
    expect(response.statusCode).toBe(200);
    const body = PartList.parse(response.json());
    expect(body.parts.map((p) => p.id)).toEqual([...registry.map((p) => p.id)].sort());
    expect(store.calls[0]?.statuses).toEqual(["draft", "active", "deprecated"]);
  });

  it("accepts comma-separated and repeated status, and a category", async () => {
    const store = memoryStore(registry);
    const { app } = setUp({ parts: store });
    await app.inject({ method: "GET", url: "/v1/parts?status=active,draft" });
    await app.inject({ method: "GET", url: "/v1/parts?status=active&status=retired&category=energy" });
    expect(store.calls.map((c) => [c.statuses, c.category])).toEqual([
      [["active", "draft"], undefined],
      [["active", "retired"], "energy"],
    ]);
  });

  it.each(["status=bogus", "status=", "category=food", "limit=5"])("rejects ?%s with a 400", async (query) => {
    const { app } = setUp();
    const body = expectJsonError(await app.inject({ method: "GET", url: `/v1/parts?${query}` }), 400, "BAD_REQUEST");
    expect(body.error.details).toBeDefined();
  });
});

describe("GET /v1/parts/:id", () => {
  it("returns every block of the part", async () => {
    const { app } = setUp();
    const response = await app.inject({ method: "GET", url: "/v1/parts/C-001" });
    expect(response.statusCode).toBe(200);
    expect(PartDetail.parse(response.json()).part.id).toBe("C-001");
  });

  it("is a 404 for an unknown part or one filtered out by status", async () => {
    const { app } = setUp();
    expectJsonError(await app.inject({ method: "GET", url: "/v1/parts/P-999" }), 404, "NOT_FOUND");
    expectJsonError(await app.inject({ method: "GET", url: "/v1/parts/C-001?status=active" }), 404, "NOT_FOUND");
  });

  it("is a 400 for a malformed id", async () => {
    const { app } = setUp();
    expectJsonError(await app.inject({ method: "GET", url: "/v1/parts/bme280" }), 400, "BAD_REQUEST");
  });
});

describe("errors and logs", () => {
  it("hides an internal error from the client and logs it once with the trace and request id", async () => {
    const failing: PartsStore = { latest: async () => Promise.reject(new Error("connection terminated")) };
    const { app, logs } = setUp({ parts: failing });
    const response = await app.inject({
      method: "GET",
      url: "/v1/parts?status=draft",
      headers: { "x-cloud-trace-context": `${TRACE}/1;o=1`, cookie: "albus_session=secret-cookie", authorization: "Bearer secret-token" },
    });

    const body = expectJsonError(response, 500, "INTERNAL");
    expect(JSON.stringify(body)).not.toContain("connection terminated");
    const requestId = response.headers["x-request-id"];
    expect(body.error.details).toEqual({ request_id: requestId });

    const [failure, completed] = logs();
    expect(failure).toMatchObject({
      severity: "ERROR",
      message: "request failed",
      requestId,
      route: "/v1/parts",
      error: { message: "connection terminated" },
      "logging.googleapis.com/trace": `projects/albusforge-staging/traces/${TRACE}`,
    });
    expect(completed).toMatchObject({ severity: "WARNING", status: 500, path: "/v1/parts", requestId });
  });

  it("logs one line per request without headers, cookies or query values", async () => {
    const { app, lines, logs } = setUp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/parts/P-001?status=draft",
      headers: { cookie: "albus_session=secret-cookie", authorization: "Bearer secret-token", "x-request-id": "forged" },
    });
    expect(response.headers["x-request-id"]).not.toBe("forged");
    expect(logs()).toEqual([
      expect.objectContaining({
        severity: "INFO",
        message: "request completed",
        method: "GET",
        route: "/v1/parts/:id",
        path: "/v1/parts/P-001",
        status: 200,
        requestId: response.headers["x-request-id"],
      }),
    ]);
    for (const secret of ["secret-cookie", "secret-token", "status=draft", "forged"]) {
      expect(lines.join("")).not.toContain(secret);
    }
  });

  it("doesn't log successful health checks", async () => {
    const { app, lines } = setUp();
    await app.inject({ method: "GET", url: "/healthz" });
    await app.inject({ method: "GET", url: "/readyz" });
    expect(lines).toEqual([]);
  });
});
