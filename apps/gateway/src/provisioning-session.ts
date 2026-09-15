import type { Pool, PoolClient } from "pg";
import { HttpError } from "./http";
import { withAuthorizedWrite } from "./authorized-write";
import { sessionTokenHash } from "./session";

export interface ProvisioningSession {
  tenantId: string;
  userId: string;
  rootSessionId: string;
  checkExpiry(): Promise<void>;
}

/** Adds handoff family identity to the common session/membership write lease. */
export async function withProvisioningSession<T>(pool: Pool, cookie: string | undefined, host: string, expectedTenant: string,
  write: (client: PoolClient, session: ProvisioningSession) => Promise<T>): Promise<T> {
  return withAuthorizedWrite(pool, cookie, host, expectedTenant, async (client, session) => {
    // The common admission helper already holds SHARE locks over this ancestry.
    const roots = (await client.query<{ id: string }>(`WITH RECURSIVE family AS (
      SELECT id,parent_session_id FROM users.sessions WHERE token_hash=$1
      UNION SELECT s.id,s.parent_session_id FROM users.sessions s JOIN family f ON s.id=f.parent_session_id
    ) SELECT id FROM family WHERE parent_session_id IS NULL`, [sessionTokenHash(cookie)])).rows;
    if (roots.length !== 1) throw new HttpError(401, "UNAUTHORIZED", "Sign in required");
    await session.recheckExpiry();
    return write(client, { tenantId: session.tenantId, userId: session.userId, rootSessionId: roots[0]!.id, checkExpiry: session.recheckExpiry });
  });
}
