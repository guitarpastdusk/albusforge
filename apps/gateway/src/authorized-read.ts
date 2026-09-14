import type { Pool, PoolClient } from "pg";
import { HttpError } from "./http";
import { readSnapshot } from "./read-snapshot";
import { sessionTokenHash, tenantSlug } from "./session";

/** Family validity, host selection, membership and data share one managed RR snapshot. */
export async function withAuthorizedRead<T>(pool: Pool, cookie: string | undefined, host: string,
  read: (client: PoolClient, identity: { tenantId: string; userId: string; role: string }) => Promise<T>): Promise<T> {
  const hash = sessionTokenHash(cookie), slug = tenantSlug(host);
  return readSnapshot(pool, async (_db, client) => {
    const session = (await client.query<{ user_id: string; active_tenant_id: string }>(`WITH RECURSIVE family AS (
      SELECT id,parent_session_id,user_id,active_tenant_id,expires_at,revoked_at FROM users.sessions WHERE token_hash=$1
      UNION SELECT s.id,s.parent_session_id,s.user_id,s.active_tenant_id,s.expires_at,s.revoked_at
        FROM users.sessions s JOIN family f ON s.id=f.parent_session_id
    ) SELECT user_id,active_tenant_id FROM users.sessions WHERE token_hash=$1
      AND NOT EXISTS(SELECT 1 FROM family WHERE revoked_at IS NOT NULL OR expires_at<=statement_timestamp()
        OR user_id<>(SELECT user_id FROM users.sessions WHERE token_hash=$1)
        OR (parent_session_id IS NOT NULL AND parent_session_id NOT IN(SELECT id FROM family)))`, [hash])).rows[0];
    if (!session) throw new HttpError(401, "UNAUTHORIZED", "Sign in required");
    const tenant = (await client.query<{ id: string }>(
      "SELECT id FROM users.tenants WHERE ($1::text IS NULL AND id=$2) OR slug=$1", [slug, session.active_tenant_id],
    )).rows[0];
    if (!tenant) throw new HttpError(404, "NOT_FOUND", "Unknown tenant");
    const member = (await client.query<{ role: string }>(
      "SELECT role FROM users.tenant_members WHERE tenant_id=$1 AND user_id=$2", [tenant.id, session.user_id],
    )).rows[0];
    if (!member) throw new HttpError(403, "FORBIDDEN", "Tenant membership required");
    return read(client, { tenantId: tenant.id, userId: session.user_id, role: member.role });
  });
}
