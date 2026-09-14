import { createTestDb as createDb, closeTestPool } from "./test-pool-shutdown";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Socket } from "node:net";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeTransaction } from "./read-snapshot";
let container: StartedPostgreSqlContainer;
beforeAll(async () => { container = await new PostgreSqlContainer("postgres:16-alpine").withTmpFs({ "/var/lib/postgresql/data": "rw,size=256m" }).start(); });
afterAll(async () => { await container?.stop(); });
function connection() {
  return createDb({ host: container.getHost(), port: container.getPort(), database: container.getDatabase(), user: container.getUsername(), password: container.getPassword(), ssl: "disable" }, { max: 1, connectTimeoutMs: 1000, statementTimeoutMs: 1000, queryTimeoutMs: 1200 });
}
const socketOf = (client: PoolClient) => (client as PoolClient & { connection: { stream: Socket } }).connection.stream;
describe("managed write transaction", () => {
  it("commits writes, rolls back failures, and fences escaped handles", async () => {
    const { pool } = connection();
    pool.on("error", () => undefined);
    try {
      await pool.query("CREATE TABLE managed_write_test(value int)");
      let escaped: PoolClient | undefined;
      await writeTransaction(pool, async (_db, client) => { escaped = client;await client.query("INSERT INTO managed_write_test VALUES(1)"); });
      await expect(escaped!.query("SELECT 1")).rejects.toThrow("closed");
      await expect(writeTransaction(pool, async (_db, client) => { await client.query("INSERT INTO managed_write_test VALUES(2)");throw new Error("abort write"); })).rejects.toThrow("abort write");
      expect((await pool.query("SELECT value FROM managed_write_test")).rows).toEqual([{ value: 1 }]);
      expect(pool.idleCount).toBe(1);
    } finally { await closeTestPool(pool); }
  });
  it.each(["BEGIN", "COMMIT", "ROLLBACK"])("recovers its sole lease after stalled %s", async (phase) => {
    const { pool } = connection();pool.on("error", () => undefined);
    let socket: Socket | undefined;
    pool.once("acquire", (client) => {
      socket = socketOf(client);const original = client.query;
      client.query = ((...args: unknown[]) => { if (typeof args[0] === "string" && args[0].startsWith(phase)) socket?.pause();return Reflect.apply(original, client, args); }) as typeof client.query;
    });
    try {
      await expect(writeTransaction(pool, async (_db, client) => { await client.query("SELECT 1"); })).rejects.toThrow();
      expect((await pool.query("SELECT 1 AS recovered")).rows[0].recovered).toBe(1);
      expect(pool.idleCount).toBe(1);expect(socket?.destroyed).toBe(true);
    } finally { socket?.resume();await closeTestPool(pool); }
  });
  it("absorbs active socket errors and recovers with a fresh connection", async () => {
    const { pool } = connection();pool.on("error", () => undefined);
    let acquired: PoolClient | undefined;pool.once("acquire", (client) => { acquired = client; });
    try {
      await expect(writeTransaction(pool, async (_db, client) => {
        expect(acquired?.listenerCount("error")).toBeGreaterThan(0);
        const query = client.query("SELECT pg_sleep(10)");
        socketOf(acquired!).destroy();
        await query;
      })).rejects.toThrow();
      expect((await pool.query("SELECT 1 AS recovered")).rows[0].recovered).toBe(1);
      expect(pool.idleCount).toBe(1);
    } finally { await closeTestPool(pool); }
  });
});
