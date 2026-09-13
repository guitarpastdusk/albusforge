/*
 * Google-signed ID tokens for web's runtime service account, fetched from the
 * Cloud Run metadata server. Imported only by server.ts (`server-only`).
 */

const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

/** Refresh this long before `exp`, so a token never expires mid-request. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Used only if a token's `exp` can't be read. Google ID tokens last an hour. */
const FALLBACK_LIFETIME_MS = 55 * 60 * 1000;

const cache = new Map<string, { token: string; expiresAt: number }>();

export function jwtExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function idToken(
  audience: string,
  { now = Date.now(), fetchImpl = fetch }: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const cached = cache.get(audience);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now) return cached.token;

  const res = await fetchImpl(`${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}&format=full`, {
    headers: { "Metadata-Flavor": "Google" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`metadata server returned ${res.status} for an ID token`);

  const token = (await res.text()).trim();
  cache.set(audience, { token, expiresAt: jwtExpiry(token) ?? now + FALLBACK_LIFETIME_MS });
  return token;
}

/** Tests only. */
export function clearIdTokenCache(): void {
  cache.clear();
}
