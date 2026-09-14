import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { Pool } from "pg";
import { MemoryObservationStorage } from "@albusforge/storage/testing";
import { expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

it("holds admission after disconnect until blocked authorization settles and never starts its upload transaction", async () => {
  let entered!: () => void;
  let unblock!: () => void;
  let disconnected!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  let firstAuthorization = true;
  const query = vi.fn(async (statement: string) => {
    if (statement.startsWith("SELECT tenant_id")) {
      if (firstAuthorization) { firstAuthorization = false; entered(); await blocked; }
      return { rows: [{ tenant_id: randomUUID() }] };
    }
    if (statement.startsWith("SELECT enabled")) return { rows: [{ enabled: true, kind: "image", payload_schema: "jpeg.v1", max_bytes: 1048576, max_width: 320, max_height: 240 }] };
    if (statement.includes("INSERT INTO telemetry.observation_attempts")) return { rows: [{ attempts: 1 }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const store = new MemoryObservationStorage();
  const create = vi.spyOn(store, "create");
  const app = buildApp({ pool: { connect } as unknown as Pool, observations: { store, maxInflight: 1 }, log: () => {} });
  app.addHook("onRequest", async (_request, reply) => { reply.raw.once("close", disconnected); });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const bytes = Buffer.from("deliberately invalid JPEG");
  const headers = { authorization: `Bearer ${"A".repeat(43)}`, "content-type": "image/jpeg",
    "x-observation-id": randomUUID(), "x-capability-id": "camera", "x-payload-schema": "jpeg.v1",
    "x-captured-at": String(Math.floor(Date.now() / 1000)), "x-content-sha256": createHash("sha256").update(bytes).digest("hex") };
  const url = `/ingest/v2/devices/${randomUUID()}/observations`;
  const first = httpRequest(`${origin}${url}`, { method: "POST", headers });
  first.on("error", () => {});
  try {
    first.end(bytes);
    await started;
    first.destroy();
    await closed;
    const excess = await app.inject({ method: "POST", url, headers, payload: bytes });
    expect(excess.statusCode).toBe(503);
    expect(excess.json().error.code).toBe("busy");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    unblock();
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    // The disconnected request may finish its admission accounting, but must
    // never begin the reservation/finalization transactions or object upload.
    expect(query.mock.calls.filter(([statement]) => statement === "BEGIN")).toHaveLength(1);
    expect(create).not.toHaveBeenCalled();
    const recovered = await app.inject({ method: "POST", url, headers, payload: bytes });
    expect(recovered.statusCode).toBe(422);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
  } finally {
    unblock(); first.destroy(); await app.close();
  }
});

it.each(["image", "measurement"] as const)("shares the total admission budget when a %s request is blocked", async firstKind => {
  let entered!: () => void;
  let fail!: (error: Error) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<never>((_resolve, reject) => { fail = reject; });
  const connect = vi.fn(() => { entered(); return blocked; });
  const app = buildApp({ pool: { connect } as unknown as Pool, maxInflight: 1,
    observations: { store: new MemoryObservationStorage(), maxInflight: 4 }, log: () => {} });
  const deviceId = randomUUID();
  const authorization = `Bearer ${"A".repeat(43)}`;
  const bytes = Buffer.from("body parsing must not reach the decoder");
  const requests = {
    image: { method: "POST" as const, url: `/ingest/v2/devices/${deviceId}/observations`,
      headers: { authorization, "content-type": "image/jpeg", "x-observation-id": randomUUID(),
        "x-capability-id": "camera", "x-payload-schema": "jpeg.v1", "x-captured-at": "1789300000",
        "x-content-sha256": createHash("sha256").update(bytes).digest("hex") }, payload: bytes },
    measurement: { method: "POST" as const, url: "/ingest/v1", headers: { authorization },
      payload: { v: 1, dev: deviceId, seq: 1, ts: 1789300000, r: [{ c: "temperature_c", t: -60, v: 22 }], st: { up_s: 1, health: ["OK"] } } },
  };
  const otherKind = firstKind === "image" ? "measurement" : "image";
  try {
    const first = app.inject(requests[firstKind]).then(response => response);
    await started;
    const other = await app.inject(requests[otherKind]);
    expect(other.statusCode).toBe(503);
    expect(other.json().error.code).toBe("busy");
    expect(other.headers["retry-after"]).toBe("1");
    expect(connect).toHaveBeenCalledTimes(1);
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
    fail(new Error("simulated database failure"));
    expect((await first).statusCode).toBe(503);
    const recovered = await app.inject(requests[otherKind]);
    expect(recovered.json().error.code).toBe("storage_unavailable");
    expect(connect).toHaveBeenCalledTimes(2);
  } finally { fail(new Error("test cleanup")); await app.close(); }
});
