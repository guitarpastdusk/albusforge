import {
  TelemetryMetadata,
  type TelemetryMetadataRequest,
} from "@albusforge/schema";
import type { Pool } from "pg";
import type { z } from "zod";
import { HttpError } from "./http";
import { writeTransaction } from "./read-snapshot";
import { sessionTokenHash, tenantSlug } from "./session";

/** Presentation updates serialize with session revocation and role changes, never with raw history layouts. */
export async function updateDeviceMetadata(
  pool: Pool,
  cookie: string | undefined,
  host: string,
  id: string,
  body: z.infer<typeof TelemetryMetadataRequest>,
) {
  const hash = sessionTokenHash(cookie),
    slug = tenantSlug(host);
  return writeTransaction(pool, async (_db, client) => {
    const sessions = (
      await client.query<{
        id: string;
        parent_session_id: string | null;
        user_id: string;
        active_tenant_id: string;
        own: boolean;
        revoked_at: Date | null;
      }>(
        `WITH RECURSIVE family AS (
      SELECT id,parent_session_id FROM users.sessions WHERE token_hash=$1
      UNION SELECT s.id,s.parent_session_id FROM users.sessions s JOIN family f ON s.id=f.parent_session_id
    ) SELECT s.id,s.parent_session_id,s.user_id,s.active_tenant_id,s.revoked_at,s.token_hash=$1 AS own
      FROM users.sessions s JOIN family f ON f.id=s.id ORDER BY s.id FOR SHARE OF s`,
        [hash],
      )
    ).rows;
    const session = sessions.find((s) => s.own);
    if (
      !session ||
      sessions.some(
        (s) =>
          s.revoked_at ||
          s.user_id !== session.user_id ||
          (s.parent_session_id &&
            !sessions.some((parent) => parent.id === s.parent_session_id)),
      )
    )
      throw new HttpError(401, "UNAUTHORIZED", "Sign in required");
    const checkExpiry = async () => {
      const expired = await client.query(
        "SELECT 1 FROM users.sessions WHERE id=ANY($1::uuid[]) AND expires_at<=statement_timestamp()",
        [sessions.map((s) => s.id)],
      );
      if (expired.rowCount)
        throw new HttpError(401, "UNAUTHORIZED", "Sign in required");
    };
    await checkExpiry();
    const tenant = (
      await client.query<{ id: string }>(
        "SELECT id FROM users.tenants WHERE ($1::text IS NULL AND id=$2) OR slug=$1",
        [slug, session.active_tenant_id],
      )
    ).rows[0];
    if (!tenant) throw new HttpError(404, "NOT_FOUND", "Unknown tenant");
    const member = (
      await client.query<{ role: string }>(
        "SELECT role FROM users.tenant_members WHERE tenant_id=$1 AND user_id=$2 FOR SHARE",
        [tenant.id, session.user_id],
      )
    ).rows[0];
    if (!member || !["admin", "operator"].includes(member.role))
      throw new HttpError(
        403,
        "FORBIDDEN",
        "An operator or admin role is required",
      );
    // A version mismatch never overwrites another person's concurrent edit.
    const updated = (
      await client.query<{
        device_id: string;
        display_name: string | null;
        version: number;
      }>(
        `UPDATE telemetry.devices SET display_name=$3,metadata_version=metadata_version+1
      WHERE tenant_id=$1 AND id=$2 AND metadata_version=$4
      RETURNING id AS device_id,display_name,metadata_version AS version`,
        [tenant.id, id, body.display_name, body.expected_version],
      )
    ).rows[0];
    // Recheck statement time after a possible concurrent device lock wait.
    await checkExpiry();
    if (!updated) {
      const exists = await client.query(
        "SELECT 1 FROM telemetry.devices WHERE tenant_id=$1 AND id=$2",
        [tenant.id, id],
      );
      if (!exists.rowCount)
        throw new HttpError(404, "NOT_FOUND", "Device not found");
      throw new HttpError(
        409,
        "METADATA_CONFLICT",
        "Device name changed; refresh before editing again",
      );
    }
    return TelemetryMetadata.parse(updated);
  });
}
