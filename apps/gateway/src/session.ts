import { createHash } from "node:crypto";
import { SESSION_COOKIE } from "@albusforge/schema";
import type { Pool, PoolClient } from "pg";
import { HttpError } from "./http";

/** Opaque 256-bit tokens, hashed exactly as stored by the session issuer. */
export function sessionTokenHash(cookie: string | undefined): string {
  const values = (cookie ?? "").split(";").flatMap((pair) => {
    const index = pair.indexOf("=");
    return index >= 0 && pair.slice(0, index).trim() === SESSION_COOKIE ? [pair.slice(index + 1).trim()] : [];
  });
  const token = values[0];
  if (values.length !== 1 || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || Buffer.from(token, "base64url").toString("base64url") !== token) {
    throw new HttpError(401, "UNAUTHORIZED", "Sign in required");
  }
  return createHash("sha256").update(token).digest("hex");
}

/** Host selects a tenant only under our public domain; forwarded headers are never trusted. */
export function tenantSlug(host: string): string | null {
  const name = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (name === "albusforge.ai" || name === "staging.albusforge.ai") return null;
  if (!name.endsWith(".albusforge.ai")) return null; // Internal SSR/localhost uses active tenant.
  const slug = name.slice(0, -".albusforge.ai".length);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || ["app", "api", "www", "ingest"].includes(slug)) {
    throw new HttpError(404, "NOT_FOUND", "Unknown tenant host");
  }
  return slug;
}

/** Authentication and reads share a consistent, read-only snapshot. */
/**
 * The same read transaction as `withSession`, for a surface that has no session
 * at all: the tenant comes from configuration and the request is never
 * consulted. Nothing about the caller is in scope here — no cookie, no host, no
 * user — so a later edit cannot derive a tenant from anything the caller
 * controls. That is the whole safety property of the public surface: a bug can
 * show the configured tenant's data or nothing, and cannot reach another
 * tenant's.
 */
export async function withPublicTenant<T>(pool: Pool, tenantId: string,
  read: (client: PoolClient, tenantId: string, userId: null) => Promise<T>,
  options: { historyLayout?: boolean } = {}): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (options.historyLayout) await client.query("LOCK TABLE ONLY telemetry.readings IN ACCESS SHARE MODE");
    // Resolved rather than trusted: a configured id that names no tenant is a
    // misconfiguration, and must not read as an empty but healthy showcase.
    const tenant = (await client.query<{ id: string }>("SELECT id FROM users.tenants WHERE id=$1", [tenantId])).rows[0];
    if (!tenant) throw new HttpError(404, "NOT_FOUND", "Unknown tenant");
    const result = await read(client, tenant.id, null);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    discard = !(error instanceof HttpError);
    await client.query("ROLLBACK").catch(() => { discard = true; });
    throw error;
  } finally { client.release(discard); }
}

export async function withSession<T>(pool: Pool, cookie: string | undefined, host: string,
  read: (client: PoolClient, tenantId: string, userId: string) => Promise<T>,
  options: { historyLayout?: boolean } = {}): Promise<T> {
  const hash = sessionTokenHash(cookie);
  const slug = tenantSlug(host);
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // LOCK is a utility statement: unlike SELECT it does not fix the RR snapshot.
    // Maintenance takes ACCESS EXCLUSIVE on this parent before moving/dropping
    // partitions or advancing retention. Lock first so auth/watermark/raw data
    // share a snapshot taken against that protected layout. Ordinary inserts
    // remain compatible. ONLY avoids locking every child for unrelated ranges.
    if (options.historyLayout) await client.query("LOCK TABLE ONLY telemetry.readings IN ACCESS SHARE MODE");
    const session = (await client.query<{ user_id: string; active_tenant_id: string }>(`WITH RECURSIVE family AS (
      SELECT id,parent_session_id,user_id,active_tenant_id,expires_at,revoked_at FROM users.sessions WHERE token_hash=$1
      UNION
      SELECT s.id,s.parent_session_id,s.user_id,s.active_tenant_id,s.expires_at,s.revoked_at
      FROM users.sessions s JOIN family f ON s.id=f.parent_session_id
    ) SELECT user_id,active_tenant_id FROM users.sessions WHERE token_hash=$1
      AND NOT EXISTS(SELECT 1 FROM family WHERE revoked_at IS NOT NULL OR expires_at <= statement_timestamp())
      AND NOT EXISTS(SELECT 1 FROM family WHERE user_id <> (SELECT user_id FROM users.sessions WHERE token_hash=$1))`, [hash])).rows[0];
    if (!session) throw new HttpError(401, "UNAUTHORIZED", "Sign in required");
    const tenant = (await client.query<{ id: string }>(
      "SELECT id FROM users.tenants WHERE ($1::text IS NULL AND id=$2) OR slug=$1", [slug, session.active_tenant_id],
    )).rows[0];
    if (!tenant) throw new HttpError(404, "NOT_FOUND", "Unknown tenant");
    const member = await client.query("SELECT 1 FROM users.tenant_members WHERE tenant_id=$1 AND user_id=$2", [tenant.id, session.user_id]);
    if (!member.rowCount) throw new HttpError(403, "FORBIDDEN", "Tenant membership required");
    const result = await read(client, tenant.id, session.user_id);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    discard = !(error instanceof HttpError);
    await client.query("ROLLBACK").catch(() => { discard = true; });
    throw error;
  } finally { client.release(discard); }
}
