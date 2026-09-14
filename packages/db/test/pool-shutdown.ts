import type { Pool, PoolClient } from "pg";
import { createDb } from "../src/client.js";

const shutdowns = new WeakMap<Pool, () => Promise<void>>();

export function createTestDb(...args: Parameters<typeof createDb>): ReturnType<typeof createDb> {
  const handle = createDb(...args);
  trackTestPool(handle.pool);
  return handle;
}

export function trackTestPool(pool: Pool): Pool {
  if (!shutdowns.has(pool)) shutdowns.set(pool, trackPoolShutdown(pool));
  return pool;
}

export async function closeTestPool(pool: Pool | undefined): Promise<void> {
  if (!pool) return;
  const close = shutdowns.get(pool);
  if (!close) throw new Error("Register fixture pools before opening their first connection");
  await close();
}

/** Register before the fixture's first connection. pg-pool can resolve end()
 * after removing idle clients but before their sockets have actually ended.
 * A disposable PostgreSQL server must remain alive until those ends arrive.
 * This observes only lifecycle events; database errors retain normal handling.
 */
export function trackPoolShutdown(pool: Pool): () => Promise<void> {
  const pending = new Set<Promise<void>>();
  const connected = (client: PoolClient) => {
    const ended = new Promise<void>(resolve => { client.once("end", resolve); });
    pending.add(ended);
    void ended.then(() => { pending.delete(ended); });
  };
  pool.on("connect", connected);
  return async () => {
    await pool.end();
    await Promise.all(pending);
    pool.off("connect", connected);
  };
}
