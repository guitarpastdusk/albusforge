import { DeviceConfig, DeviceHandoffRequest, DeviceSetupParams, routes } from "@albusforge/schema";
import { unstable_rethrow } from "next/navigation";
import { ApiRequestError } from "@/lib/api/core";
import { apiMutationAction } from "@/lib/api/server";
import { assertActionOrigin } from "@/lib/api/action-origin";

const privateHeaders = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
/** POST-only attachment transport: the secret never enters a React render or Server Action result. */
export async function POST(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const refused = (status: number, message: string) => Response.json({ error: { message } }, { status, headers: privateHeaders });
  try { assertActionOrigin(request.headers.get("origin"), request.headers.get("host")); }
  catch { return refused(403, "A same-origin request is required."); }
  const target = DeviceSetupParams.safeParse({ id: (await params).deviceId });
  if (!target.success) return refused(400, "Invalid device ID.");
  let input: unknown;
  try { input = await request.json(); } catch { return refused(400, "Invalid configuration request."); }
  const body = DeviceHandoffRequest.safeParse(input);
  if (!body.success) return refused(400, "Refresh setup before downloading configuration.");
  try {
    const configuration = await apiMutationAction("POST", routes.deviceProvisioning.download.path(target.data.id), DeviceConfig, body.data);
    return new Response(JSON.stringify(configuration), { headers: { ...privateHeaders, "content-type": "application/json", "content-disposition": 'attachment; filename="device-config.json"' } });
  } catch (error) {
    if (error instanceof ApiRequestError && [401, 403, 404, 409, 410, 503].includes(error.status)) return refused(error.status,
      error.status === 410 ? "This handoff was used or expired. Replace configuration to obtain a fresh file."
        : "Your access or configuration changed. Refresh setup before trying again.");
    unstable_rethrow(error);
    return refused(503, "The download could not be confirmed. Refresh setup before retrying; a lost handoff requires explicit replacement.");
  }
}
