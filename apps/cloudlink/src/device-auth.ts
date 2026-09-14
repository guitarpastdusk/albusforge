import { createHash } from "node:crypto";

/** Shared credential grammar and hashing for all device-facing payload kinds. */
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export function bearerHash(authorization: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "");
  return match ? tokenHash(match[1]!) : null;
}
