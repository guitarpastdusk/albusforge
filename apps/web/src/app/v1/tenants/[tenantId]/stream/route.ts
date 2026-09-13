import { loadRuntimeConfig } from "@/lib/runtime-config";
import { proxyGatewayStream } from "@/lib/api/gateway-stream.server";

/** Local same-origin stream; staging/prod route /v1 directly to gateway. */
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  const { tenantId } = await params;
  const devices = new URL(request.url).searchParams.get("devices");
  if (loadRuntimeConfig(process.env).apiMode === "mock") {
    const { mockTenantStream } = await import("@/mocks/stream");
    return mockTenantStream(tenantId, devices?.split(",").filter(Boolean) ?? [], request.signal);
  }
  const query = devices === null ? "" : `?${new URLSearchParams({ devices })}`;
  return proxyGatewayStream(`/v1/tenants/${encodeURIComponent(tenantId)}/stream${query}`, request);
}
