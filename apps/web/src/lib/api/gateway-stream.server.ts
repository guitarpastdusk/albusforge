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
 */
export async function proxyGatewayStream(path: string, request: Request): Promise<Response> {
  const base = process.env.GATEWAY_INTERNAL_URL?.replace(/\/+$/, "");
  if (!base) return new Response("GATEWAY_INTERNAL_URL is not set", { status: 503 });

  const auth = process.env.GATEWAY_INTERNAL_AUTH ?? "metadata";
  if (auth !== "metadata" && auth !== "none") return new Response("GATEWAY_INTERNAL_AUTH is invalid", { status: 500 });
  const token = auth === "metadata" ? await idToken(base) : null;

  const { trustedProxyHops } = loadRuntimeConfig(process.env);
  const lastEventId = request.headers.get("last-event-id");
  const upstream = await fetch(base + path, {
    cache: "no-store",
    signal: request.signal,
    headers: {
      accept: "text/event-stream",
      ...gatewayHeaders(
        { host: request.headers.get("host"), forwardedFor: request.headers.get("x-forwarded-for"), cookie: request.headers.get("cookie") },
        token,
        trustedProxyHops,
      ),
      ...(lastEventId ? { "last-event-id": lastEventId } : {}),
    },
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-store",
    },
  });
}
