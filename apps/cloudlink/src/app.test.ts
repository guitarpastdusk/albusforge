import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

it("bounds admission, keeps health independent and releases capacity after failure", async () => {
  let entered!: () => void, fail!: (reason: Error) => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const blocked = new Promise<never>((_resolve, reject) => { fail = reject; });
  const connect = vi.fn(() => { entered(); return blocked; });
  const logs: Record<string, unknown>[] = [];
  const app = buildApp({ pool: { connect, query: () => Promise.reject(new Error("private database detail")) } as unknown as Pool, maxInflight: 1, log: (line) => logs.push(line) });
  const request = { method: "POST" as const, url: "/ingest/v1", headers: { authorization: `Bearer ${"A".repeat(43)}` },
    payload: { v: 1, dev: randomUUID(), seq: 1, ts: 1789300000, r: [{ c: "temperature_c", t: -60, v: 4 }], st: { up_s: 1, health: ["OK"] } } };
  try {
    const first = app.inject(request).then((r) => r);
    await started;
    const excess = await app.inject(request);
    expect(excess.statusCode).toBe(503);
    expect(excess.headers["retry-after"]).toBe("1");
    expect(excess.json().error.code).toBe("busy");
    expect(connect).toHaveBeenCalledTimes(1);
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/readyz" })).statusCode).toBe(503);
    expect((await app.inject({ url: "/v1/parts" })).statusCode).toBe(404);
    fail(new Error("private database detail"));
    expect((await first).statusCode).toBe(503);
    expect((await app.inject(request)).json().error.code).toBe("storage_unavailable");
    expect(connect).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logs)).not.toContain("private database detail");
    expect(JSON.stringify(logs)).not.toContain("A".repeat(43));
  } finally { await app.close(); }
});
