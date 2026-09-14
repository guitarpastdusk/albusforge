import { z } from "zod";
import { SensorCapabilityId } from "@albusforge/schema";
import { proxyGatewayStream } from "@/lib/api/gateway-stream.server";
const Params = z.strictObject({ deviceId: z.uuid(), capabilityId: SensorCapabilityId, observationId: z.uuidv4() });
/** Production edge routes /v1 directly to gateway; this is the equivalent local proxy. */
export async function GET(request: Request, { params }: { params: Promise<{ deviceId: string; capabilityId: string; observationId: string }> }) {
  const parsed = Params.safeParse(await params);
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (!parsed.success) return new Response("Not found", { status: 404, headers });
  const { deviceId, capabilityId, observationId } = parsed.data;
  const response = await proxyGatewayStream(`/v1/devices/${deviceId}/capabilities/${encodeURIComponent(capabilityId)}/images/${observationId}/content`, request, "image/jpeg");
  if (response.ok && response.headers.get("content-type") !== "image/jpeg") {
    await response.body?.cancel();
    return new Response("Image unavailable", { status: 503, headers });
  }
  for (const [key,value] of Object.entries(headers)) response.headers.set(key,value);
  return response;
}
