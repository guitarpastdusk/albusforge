import { loadRuntimeConfig } from "@/lib/runtime-config";
import { mockTenantStream } from "@/mocks/stream";

/**
 * GET /v1/tenants/:id/stream, for local development only.
 *
 * On staging and prod the load balancer sends every `/v1/*` path to gateway
 * (ADR 0007), so this handler is never reached there. Locally nothing routes
 * `/v1`, and the browser's EventSource needs a same-origin URL, so:
 * - mock mode serves synthetic readings from the mock fleet;
 * - live mode will proxy to gateway with `proxyGatewayStream` (lib/api/gateway-stream.server.ts, PR #34)
 *   once it lands; until then it answers 501, the same as gateway does for a route it hasn't built.
 * Which branch runs follows `API_MODE`, the same switch as every other call, so
 * mock mode never reaches gateway and live mode never serves synthetic data.
 * The startup guard refuses mock mode on Cloud Run.
 */
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  const { tenantId } = await params;
  const { apiMode } = loadRuntimeConfig(process.env);

  if (apiMode === "mock") {
    const devices = new URL(request.url).searchParams.get("devices")?.split(",").filter(Boolean) ?? [];
    return mockTenantStream(tenantId, devices, request.signal);
  }

  return Response.json(
    { error: { code: "NOT_IMPLEMENTED", message: "The local stream proxy to gateway is not wired yet." } },
    { status: 501 },
  );
}
