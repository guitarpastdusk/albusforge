import "server-only";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { gatewayHeaders } from "./gateway-headers.server";
import { idToken } from "./id-token.server";

/**
 * Proxy a gateway Server-Sent Events stream through the portal, for where the
 * browser's same-origin `/v1/...` doesn't reach gateway directly: local
 * development. On staging and prod the load balancer routes `/v1/*` to
 * gateway, so the portal never serves these paths there.
 *
 * Same headers as every server-side gateway call (ADR 0007): the internal ID
 * token, the original host, the client IP, and only the allowlisted cookies.
 * `Last-Event-ID` is passed through so a reconnect resumes.
 *
 * The request carries the internal token in a header, which a cross-origin
 * redirect would not strip, so `path` must resolve to the configured gateway
 * and a redirect is an error rather than a second authenticated hop.
 */
export async function proxyGatewayStream(path: string, request: Request, accept = "text/event-stream"): Promise<Response> {
  const base = process.env.GATEWAY_INTERNAL_URL?.replace(/\/+$/, "");
  if (!base) return new Response("GATEWAY_INTERNAL_URL is not set", { status: 503 });

  const auth = process.env.GATEWAY_INTERNAL_AUTH ?? "metadata";
  if (auth !== "metadata" && auth !== "none") return new Response("GATEWAY_INTERNAL_AUTH is invalid", { status: 500 });

  // Before any credential is fetched or sent: an absolute gateway API path,
  // resolving to gateway's own origin. `base + path` alone is no origin
  // check — "/v1" plus ".evil.example/x" would extend the hostname.
  const url = gatewayUrl(base, path);
  if (!url) return new Response("invalid gateway path", { status: 500 });

  const token = auth === "metadata" ? await idToken(base) : null;
  const { trustedProxyHops } = loadRuntimeConfig(process.env);
  const lastEventId = request.headers.get("last-event-id");

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      cache: "no-store",
      signal: request.signal,
      // A redirect would send the internal token to wherever it points.
      redirect: "error",
      headers: {
        accept,
        ...gatewayHeaders(
          { host: request.headers.get("host"), forwardedFor: request.headers.get("x-forwarded-for"), cookie: request.headers.get("cookie") },
          token,
          trustedProxyHops,
        ),
        ...(lastEventId ? { "last-event-id": lastEventId } : {}),
      },
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    // A redirect (or a transport failure): never relay its Location.
    return new Response("gateway stream unavailable", { status: 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-store",
    },
  });
}

/** `base + path` as a URL on gateway's own origin, or null: an absolute path, no scheme, host or traversal. */
function gatewayUrl(base: string, path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("..")) return null;
  let candidate: URL;
  let gateway: URL;
  try {
    gateway = new URL(base);
    candidate = new URL(base + path);
  } catch {
    return null;
  }
  return candidate.origin === gateway.origin ? candidate.toString() : null;
}
