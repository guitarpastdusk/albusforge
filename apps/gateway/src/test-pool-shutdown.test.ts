import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { trackPoolShutdown } from "./test-pool-shutdown";

it("keeps the fixture alive after pool.end until every connected client ends", async () => {
  const pool = Object.assign(new EventEmitter(), { end: vi.fn(async () => {}) });
  const close = trackPoolShutdown(pool as unknown as Pool);
  const first = new EventEmitter(), second = new EventEmitter();
  pool.emit("connect", first); pool.emit("connect", second);
  let stopped = false;
  const stopping = close().then(() => { stopped = true; });
  await Promise.resolve();
  expect(pool.end).toHaveBeenCalledOnce();
  expect(stopped).toBe(false);
  first.emit("end");
  await Promise.resolve();
  expect(stopped).toBe(false);
  second.emit("end");
  await stopping;
  expect(stopped).toBe(true);
  expect(pool.listenerCount("connect")).toBe(0);
});

it("does not suppress genuine pool or client errors", async () => {
  const pool = Object.assign(new EventEmitter(), { end: vi.fn(async () => {}) });
  const close = trackPoolShutdown(pool as unknown as Pool);
  const client = new EventEmitter(); pool.emit("connect", client);
  expect(() => pool.emit("error", new Error("database failure"))).toThrow("database failure");
  expect(() => client.emit("error", new Error("connection failure"))).toThrow("connection failure");
  client.emit("end");
  await close();
});
