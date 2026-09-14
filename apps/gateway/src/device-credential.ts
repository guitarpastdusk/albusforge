import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface CredentialBinding {
  deviceId: string;
  tenantId: string;
  buildId: string;
  planVersion: number;
  handoffVersion: number;
}
export interface SealedCredential {
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}
export interface HandoffKeys { active: string; keys: ReadonlyMap<string, Buffer> }
const canonical = (value: string, length: number) => /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, "base64url").length === length && Buffer.from(value, "base64url").toString("base64url") === value;
const aad = (binding: CredentialBinding) => Buffer.from(JSON.stringify(["albusforge/device-handoff/v1", binding.tenantId, binding.buildId, binding.planVersion, binding.deviceId, binding.handoffVersion]));

/** Server-only keyring. No fallback key, and failures never echo values or JSON parser output. */
export function parseHandoffKeys(input: string | undefined): HandoffKeys | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input) as { active?: unknown; keys?: unknown };
    if (!parsed || typeof parsed !== "object" || Object.keys(parsed).sort().join(",") !== "active,keys"
      || typeof parsed.active !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(parsed.active)
      || !parsed.keys || typeof parsed.keys !== "object" || Array.isArray(parsed.keys)) throw new Error();
    const entries = Object.entries(parsed.keys);
    if (!entries.length || entries.length > 4) throw new Error();
    const keys = new Map<string, Buffer>();
    for (const [id, value] of entries) {
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || typeof value !== "string" || !canonical(value, 32)) throw new Error();
      keys.set(id, Buffer.from(value, "base64url"));
    }
    if (!keys.has(parsed.active)) throw new Error();
    return { active: parsed.active, keys };
  } catch { throw new Error("Invalid DEVICE_HANDOFF_KEYS; expected an active key ID and 1–4 canonical 256-bit keys"); }
}

/** Only a short-lived encrypted handoff is persisted; compiled artifacts remain credential-free. */
export function sealCredential(token: string, binding: CredentialBinding, ring: HandoffKeys): SealedCredential {
  const key = ring.keys.get(ring.active);
  if (!key || !canonical(token, 32)) throw new Error("Device handoff encryption unavailable");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { keyId: ring.active, nonce: nonce.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

export function openCredential(sealed: SealedCredential, binding: CredentialBinding, ring: HandoffKeys): string {
  try {
    const key = ring.keys.get(sealed.keyId);
    if (!key || !canonical(sealed.nonce, 12) || !canonical(sealed.tag, 16) || !canonical(sealed.ciphertext, 43)) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.nonce, "base64url"));
    cipher.setAAD(aad(binding));
    cipher.setAuthTag(Buffer.from(sealed.tag, "base64url"));
    const token = Buffer.concat([cipher.update(Buffer.from(sealed.ciphertext, "base64url")), cipher.final()]).toString("utf8");
    if (!canonical(token, 32)) throw new Error();
    return token;
  } catch { throw new Error("Device handoff cannot be decrypted"); }
}
