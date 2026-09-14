import { createClientDb, type Db } from "@albusforge/db";
import type { Pool, PoolClient } from "pg";

/** Own every phase of a short read lease, including BEGIN and transport errors. */
export const readSnapshot = <T>(pool: Pool, read: (db: Db, client: PoolClient) => Promise<T>): Promise<T> =>
  managedTransaction(pool, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", read);

/** Mutation callers own their row locks; transport/cleanup ownership is shared. */
export const writeTransaction = <T>(pool: Pool, write: (db: Db, client: PoolClient) => Promise<T>): Promise<T> =>
  managedTransaction(pool, "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE", write);

async function managedTransaction<T>(pool: Pool, begin: string, read: (db: Db, client: PoolClient) => Promise<T>): Promise<T> {
  let connectionError: Error | undefined;
  const onError = (error: Error) => { connectionError = error; };
  // Install before resolving the checkout promise: the pool's idle listener
  // no longer covers an acquired client, including the first await boundary.
  const client = await new Promise<PoolClient>((resolve, reject) => {
    pool.connect((error, acquired) => {
      if (error) return reject(error);
      if (!acquired) return reject(new Error("Database checkout returned no client"));
      acquired.on("error", onError);
      resolve(acquired);
    });
  });
  const scoped = createClientDb(client);
  let clean = false;
  try {
    if (connectionError) throw connectionError;
    await scoped.client.query(begin);
    const result = await read(scoped.db, scoped.client);
    if (connectionError) throw connectionError;
    await scoped.client.query("COMMIT");
    // Fence the handle and verify clean protocol state before pool reuse.
    await scoped.close({ withinMs: 1000 });
    if (connectionError) throw connectionError;
    clean = true;
    return result;
  } finally {
    if (!clean) {
      // BEGIN/COMMIT/read timeouts leave protocol state uncertain. Do not queue
      // another statement behind a stalled response; destruction rolls back
      // server state and frees pool capacity. Fence without a cleanup wait.
      await scoped.close({ withinMs: 0 }).catch(() => undefined);
    }
    client.release(!clean || connectionError !== undefined);
    // release installs the pool's idle listener synchronously on healthy
    // clients. Broken clients retain ours through their eventual termination.
    if (clean && !connectionError) client.off("error", onError);
  }
}
