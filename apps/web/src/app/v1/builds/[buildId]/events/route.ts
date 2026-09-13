import type { NextRequest } from "next/server";
import { proxyGatewayStream } from "@/lib/api/gateway-stream.server";
import { loadRuntimeConfig } from "@/lib/runtime-config";

/**
 * GET /v1/builds/:id/events for local development. The browser subscribes on
 * its own origin; on staging and prod the load balancer sends `/v1/*` to
 * gateway, so this route is never reached there. Locally it proxies to
 * gateway (API_MODE=live) or streams the mock conversation (API_MODE=mock).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ buildId: string }> }): Promise<Response> {
  const { buildId } = await params;
  if (loadRuntimeConfig(process.env).apiMode === "mock") {
    const { mockBuildEvents } = await import("@/mocks/build-events");
    return mockBuildEvents(buildId, request.signal);
  }
  return proxyGatewayStream(`/v1/builds/${encodeURIComponent(buildId)}/events`, request);
}
