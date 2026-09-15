import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DeviceConfig, DeviceProvisioning, type DeviceClaimRequest, type DeviceHandoffRequest, type DeviceReissueRequest } from "@albusforge/schema";
import type { Pool, PoolClient } from "pg";
import type { z } from "zod";
import { HttpError } from "./http";
import { sessionTokenHash } from "./session";
import { withAuthorizedRead } from "./authorized-read";
import { loadProvisioningAuthority } from "./provisioning-authority";
import { type ProvisioningProfile } from "./provisioning-profile";
import { withProvisioningSession, type ProvisioningSession } from "./provisioning-session";
import { openCredential, sealCredential, type HandoffKeys } from "./device-credential";

type Identity = Pick<ProvisioningSession, "tenantId" | "userId" | "rootSessionId"> & { mayDownload?: boolean };
interface PublicRow {
  device_id: string; build_id: string; plan_version: number; code_version: number; credential_version: number;
  handoff_expires_at: Date; handoff_consumed_at: Date | null; handoff_user_id: string | null; handoff_session_root: string | null;
  created_at: Date; revoked_at: Date | null; checked_at: Date; sealed_ready: boolean;
}
interface LockedRow extends PublicRow {
  claim_request_id: string; manifest_digest: string; ingest_url: string; seq_start: string;
  handoff_key_id: string | null; handoff_nonce: string | null; handoff_ciphertext: string | null; handoff_tag: string | null;
  reissue_request_id: string | null; reissue_from_version: number | null; token_hash: string; last_seq: string | null;
}
const publicColumns = `p.device_id,p.build_id,p.plan_version,p.code_version,p.credential_version,p.handoff_expires_at,
  p.handoff_consumed_at,p.handoff_user_id,p.handoff_session_root,p.created_at,d.revoked_at,statement_timestamp() AS checked_at,
  p.handoff_key_id IS NOT NULL AS sealed_ready`;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const binding = (row: Pick<PublicRow, "device_id" | "build_id" | "plan_version" | "credential_version">, tenantId: string) => ({ deviceId: row.device_id, tenantId, buildId: row.build_id, planVersion: row.plan_version, handoffVersion: row.credential_version });
const status = (row: PublicRow, identity: Identity) => DeviceProvisioning.parse({
  device_id: row.device_id, build_id: row.build_id, plan_version: row.plan_version, code_version: row.code_version,
  credential_version: row.credential_version, created_at: row.created_at.toISOString(), handoff_expires_at: row.handoff_expires_at.toISOString(),
  state: row.revoked_at ? "credential_revoked" : row.handoff_consumed_at ? "configuration_downloaded" : row.handoff_expires_at <= row.checked_at ? "configuration_expired" : "configuration_ready",
  handoff_available: !row.revoked_at && !row.handoff_consumed_at && row.handoff_expires_at > row.checked_at && row.sealed_ready
    && row.handoff_user_id === identity.userId && row.handoff_session_root === identity.rootSessionId && identity.mayDownload !== false,
});
const mismatch = () => new HttpError(409, "CONFIGURATION_CHANGED", "Configuration changed; refresh before trying again");

/** Identity and all handoff transitions serialize on build → device → provisioning rows. */
async function locked(client: PoolClient, tenantId: string, deviceId: string): Promise<LockedRow> {
  const locator = (await client.query<{ build_id: string }>("SELECT build_id FROM telemetry.device_provisionings WHERE tenant_id=$1 AND device_id=$2", [tenantId, deviceId])).rows[0];
  if (!locator || !(await client.query("SELECT id FROM builds.builds WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [locator.build_id, tenantId])).rowCount) throw new HttpError(404, "NOT_FOUND", "Device not found");
  if (!(await client.query("SELECT id FROM telemetry.devices WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [deviceId, tenantId])).rowCount) throw new HttpError(404, "NOT_FOUND", "Device not found");
  const row = (await client.query<LockedRow>(`SELECT ${publicColumns},p.claim_request_id,p.manifest_digest,p.ingest_url,p.seq_start,
    p.handoff_key_id,p.handoff_nonce,p.handoff_ciphertext,p.handoff_tag,p.reissue_request_id,p.reissue_from_version,d.token_hash,d.last_seq
    FROM telemetry.device_provisionings p JOIN telemetry.devices d ON d.id=p.device_id AND d.tenant_id=p.tenant_id
    WHERE p.tenant_id=$1 AND p.device_id=$2 FOR UPDATE OF p`, [tenantId, deviceId])).rows[0];
  if (!row) throw new HttpError(404, "NOT_FOUND", "Device not found");
  return row;
}

export interface DeviceProvisioningOptions {
  keys: HandoffKeys | null;
  ingestUrl: string | null;
  profiles: readonly ProvisioningProfile[];
}
export function createDeviceProvisioningStore(pool: Pool, options: DeviceProvisioningOptions) {
  const configured = () => {
    if (!options.keys || !options.ingestUrl) throw new HttpError(503, "PROVISIONING_UNAVAILABLE", "Secure device configuration is not configured");
    return { keys: options.keys, ingestUrl: options.ingestUrl };
  };
  return {
    async get(cookie: string | undefined, host: string, deviceId: string) {
      return withAuthorizedRead(pool, cookie, host, async (client, { tenantId, userId, role }) => {
        const row = (await client.query<PublicRow>(`SELECT ${publicColumns} FROM telemetry.device_provisionings p
          JOIN telemetry.devices d ON d.id=p.device_id AND d.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.device_id=$2`, [tenantId, deviceId])).rows[0];
        if (!row) throw new HttpError(404, "NOT_FOUND", "Device not found");
        const roots = (await client.query<{ id: string }>(`WITH RECURSIVE family AS (
          SELECT id,parent_session_id FROM users.sessions WHERE token_hash=$1 UNION
          SELECT s.id,s.parent_session_id FROM users.sessions s JOIN family f ON s.id=f.parent_session_id
        ) SELECT id FROM family WHERE parent_session_id IS NULL`, [sessionTokenHash(cookie)])).rows;
        const mayDownload = ["admin", "operator"].includes(role);
        return status(row, { tenantId, userId, rootSessionId: roots.length === 1 ? roots[0]!.id : "", mayDownload });
      });
    },
    async claim(cookie: string | undefined, host: string, body: z.infer<typeof DeviceClaimRequest>) {
      return withProvisioningSession(pool, cookie, host, body.expected_tenant_id, async (client, session) => {
        // Serialize this tenant/request identity before build locks, including retries targeting another build.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`device-claim:${session.tenantId}:${body.request_id}`]);
        if (!(await client.query("SELECT id FROM builds.builds WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [body.build_id, session.tenantId])).rowCount) throw new HttpError(404, "NOT_FOUND", "Build not found");
        const request = (await client.query<{ build_id: string; plan_version: number; code_version: number }>("SELECT build_id,plan_version,code_version FROM telemetry.device_provisionings WHERE tenant_id=$1 AND claim_request_id=$2", [session.tenantId, body.request_id])).rows[0];
        if (request && (request.build_id !== body.build_id || request.plan_version !== body.plan_version || request.code_version !== body.code_version)) throw mismatch();
        const existing = (await client.query<{ device_id: string }>("SELECT device_id FROM telemetry.device_provisionings WHERE tenant_id=$1 AND build_id=$2 AND plan_version=$3", [session.tenantId, body.build_id, body.plan_version])).rows[0];
        if (existing) {
          const row = await locked(client, session.tenantId, existing.device_id);
          if (row.code_version !== body.code_version) throw mismatch();
          await session.checkExpiry();
          return status(row, session);
        }
        const authority = await loadProvisioningAuthority(client, session.tenantId, body.build_id, body.plan_version, body.code_version, options.profiles);
        const config = configured(), deviceId = randomUUID(), token = randomBytes(32).toString("base64url");
        const sealed = sealCredential(token, { deviceId, tenantId: session.tenantId, buildId: body.build_id, planVersion: body.plan_version, handoffVersion: 1 }, config.keys);
        await session.checkExpiry();
        await client.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source,next_s) VALUES($1,$2,$3,$4,$5,$6)", [deviceId, session.tenantId, hash(token), authority.channels, authority.source, authority.nextS]);
        for (const cap of authority.capabilities) {
          await client.query(`INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,enabled,required,interval_s,max_bytes,max_width,max_height,channels)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [deviceId, cap.id, cap.kind, cap.schema, cap.profile_id, cap.profile_version, cap.enabled, cap.required, cap.interval_s,
            cap.kind === "image" ? cap.max_bytes : null, cap.kind === "image" ? cap.max_width : null, cap.kind === "image" ? cap.max_height : null, cap.kind === "measurement" ? cap.channels : null]);
        }
        await client.query(`INSERT INTO telemetry.device_provisionings(device_id,tenant_id,build_id,plan_version,code_version,claim_request_id,created_by,
          manifest_digest,ingest_url,handoff_user_id,handoff_session_root,handoff_expires_at,handoff_key_id,handoff_nonce,handoff_ciphertext,handoff_tag)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$10,statement_timestamp()+interval '10 minutes',$11,$12,$13,$14)`,
        [deviceId, session.tenantId, body.build_id, body.plan_version, body.code_version, body.request_id, session.userId, authority.firmware.manifest_digest,
          config.ingestUrl, session.rootSessionId, sealed.keyId, sealed.nonce, sealed.ciphertext, sealed.tag]);
        return status(await locked(client, session.tenantId, deviceId), session);
      });
    },
    async download(cookie: string | undefined, host: string, deviceId: string, body: z.infer<typeof DeviceHandoffRequest>) {
      return withProvisioningSession(pool, cookie, host, body.expected_tenant_id, async (client, session) => {
        const row = await locked(client, session.tenantId, deviceId);
        await session.checkExpiry();
        if (row.credential_version !== body.expected_version) throw mismatch();
        if (row.revoked_at) throw new HttpError(409, "DEVICE_REVOKED", "This device credential is revoked");
        if (row.handoff_user_id !== session.userId || row.handoff_session_root !== session.rootSessionId) throw new HttpError(403, "HANDOFF_OWNER_REQUIRED", "Replace configuration to issue a handoff for this sign-in session");
        if (row.handoff_consumed_at || row.handoff_expires_at <= row.checked_at || !row.handoff_key_id || !row.handoff_nonce || !row.handoff_ciphertext || !row.handoff_tag) throw new HttpError(410, "HANDOFF_UNAVAILABLE", "Configuration was downloaded or expired; replace it to obtain a fresh file");
        const authority = await loadProvisioningAuthority(client, session.tenantId, row.build_id, row.plan_version, row.code_version, options.profiles, false);
        if (authority.firmware.manifest_digest !== row.manifest_digest) throw mismatch();
        let token: string;
        try { token = openCredential({ keyId: row.handoff_key_id, nonce: row.handoff_nonce, ciphertext: row.handoff_ciphertext, tag: row.handoff_tag }, binding(row, session.tenantId), configured().keys); }
        catch { throw new HttpError(410, "HANDOFF_UNAVAILABLE", "Configuration is unavailable; replace it to obtain a fresh file"); }
        if (hash(token) !== row.token_hash) throw new HttpError(410, "HANDOFF_UNAVAILABLE", "Configuration is unavailable; replace it to obtain a fresh file");
        const output = DeviceConfig.safeParse({ v: authority.capabilities.length ? 2 : 1, device_id: deviceId, token, ingest_url: row.ingest_url, seq_start: Number(row.seq_start),
          profile_id: authority.firmware.manifest.profile_id, runtime: authority.firmware.manifest.runtime, channels: authority.channels,
          build_id: row.build_id, plan_version: row.plan_version, code_version: row.code_version, manifest_digest: row.manifest_digest,
          ...(authority.capabilities.length ? { capabilities: authority.capabilities,
            observation_url: row.ingest_url.replace(/\/ingest\/v1$/, `/ingest/v2/devices/${deviceId}/observations`) } : {}) });
        if (!output.success) throw new HttpError(410, "HANDOFF_UNAVAILABLE", "Configuration is unavailable; replace it to obtain a fresh file");
        await session.checkExpiry();
        const consumed = await client.query(`UPDATE telemetry.device_provisionings SET handoff_consumed_at=statement_timestamp(),
          handoff_key_id=NULL,handoff_nonce=NULL,handoff_ciphertext=NULL,handoff_tag=NULL
          WHERE device_id=$1 AND handoff_expires_at>statement_timestamp()`, [deviceId]);
        if (!consumed.rowCount) throw new HttpError(410, "HANDOFF_UNAVAILABLE", "Configuration expired; replace it to obtain a fresh file");
        return output.data;
      });
    },
    async reissue(cookie: string | undefined, host: string, deviceId: string, body: z.infer<typeof DeviceReissueRequest>) {
      return withProvisioningSession(pool, cookie, host, body.expected_tenant_id, async (client, session) => {
        const row = await locked(client, session.tenantId, deviceId);
        await session.checkExpiry();
        if (row.revoked_at) throw new HttpError(409, "DEVICE_REVOKED", "This device credential is revoked");
        if (row.reissue_request_id === body.request_id && row.reissue_from_version === body.expected_version) return status(row, session);
        if (row.credential_version !== body.expected_version || row.reissue_request_id === body.request_id) throw mismatch();
        const authority = await loadProvisioningAuthority(client, session.tenantId, row.build_id, row.plan_version, row.code_version, options.profiles, false);
        if (authority.firmware.manifest_digest !== row.manifest_digest) throw mismatch();
        const config = configured(), version = row.credential_version + 1, seqStart = row.last_seq === null ? 0 : Number(row.last_seq) + 1;
        if (!Number.isSafeInteger(seqStart) || version > 2147483647) throw new HttpError(409, "IDENTITY_EXHAUSTED", "This identity cannot issue another configuration");
        const token = randomBytes(32).toString("base64url");
        const sealed = sealCredential(token, binding({ ...row, credential_version: version }, session.tenantId), config.keys);
        await session.checkExpiry();
        await client.query("UPDATE telemetry.devices SET token_hash=$2 WHERE id=$1", [deviceId, hash(token)]);
        await client.query(`UPDATE telemetry.device_provisionings SET credential_version=$2,seq_start=$3,ingest_url=$4,
          handoff_user_id=$5,handoff_session_root=$6,handoff_expires_at=statement_timestamp()+interval '10 minutes',handoff_consumed_at=NULL,
          handoff_key_id=$7,handoff_nonce=$8,handoff_ciphertext=$9,handoff_tag=$10,reissue_request_id=$11,reissue_from_version=$12 WHERE device_id=$1`,
        [deviceId, version, seqStart, config.ingestUrl, session.userId, session.rootSessionId, sealed.keyId, sealed.nonce, sealed.ciphertext, sealed.tag, body.request_id, body.expected_version]);
        return status(await locked(client, session.tenantId, deviceId), session);
      });
    },
    async revoke(cookie: string | undefined, host: string, deviceId: string, body: z.infer<typeof DeviceHandoffRequest>) {
      return withProvisioningSession(pool, cookie, host, body.expected_tenant_id, async (client, session) => {
        const row = await locked(client, session.tenantId, deviceId);
        await session.checkExpiry();
        if (row.credential_version !== body.expected_version) throw mismatch();
        await client.query("UPDATE telemetry.devices SET revoked_at=COALESCE(revoked_at,statement_timestamp()) WHERE id=$1", [deviceId]);
        await client.query("UPDATE telemetry.device_provisionings SET handoff_key_id=NULL,handoff_nonce=NULL,handoff_ciphertext=NULL,handoff_tag=NULL WHERE device_id=$1", [deviceId]);
        return status(await locked(client, session.tenantId, deviceId), session);
      });
    },
  };
}
