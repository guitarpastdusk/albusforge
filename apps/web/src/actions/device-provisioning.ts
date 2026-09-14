"use server";
import { DeviceClaimRequest, DeviceHandoffRequest, DeviceProvisioning, DeviceReissueRequest, DeviceSetupParams, routes } from "@albusforge/schema";
import { ApiRequestError } from "@/lib/api/core";
import { apiMutationAction } from "@/lib/api/server";
import { actionFailure } from "@/lib/action-errors";

async function failure(action: string, error: unknown) {
  if (error instanceof ApiRequestError && [400, 401, 403, 404, 409, 410, 503].includes(error.status)) {
    return { ok: false as const, refresh: [401, 403, 404, 409, 410].includes(error.status), message:
      error.code === "PLAN_NOT_ACCEPTED" ? "Accept this plan in the project workspace before registering a device."
      : error.code === "PLAN_STALE" ? "The specification changed. Accept a current plan and compile its firmware first."
      : error.code === "FIRMWARE_NOT_READY" ? "Supported firmware for this exact plan is not ready. Return to the project workspace."
      : error.code === "PROVISIONING_UNAVAILABLE" ? "This build cannot be provisioned yet. It needs approved hardware, channel and firmware evidence, and a configured secure handoff service."
      : error.code === "DEVICE_REVOKED" ? "This identity is revoked and cannot issue another configuration."
      : "Your session, workspace or configuration changed. Refresh before trying again." };
  }
  await actionFailure(action, error, "The device configuration operation could not be confirmed.");
  return { ok: false as const, refresh: true, message: "The operation could not be confirmed. Refresh to check its state before retrying." };
}
export async function claimSelfFlash(input: unknown) {
  const body = DeviceClaimRequest.safeParse(input);
  if (!body.success) return { ok: false as const, refresh: false, message: "Open setup from an accepted plan's compiled firmware." };
  try { return { ok: true as const, data: await apiMutationAction("POST", routes.deviceProvisioning.claim.path(), DeviceProvisioning, body.data) }; }
  catch (error) { return failure("claimSelfFlash", error); }
}
export async function replaceDeviceConfiguration(id: unknown, input: unknown) {
  const params = DeviceSetupParams.safeParse({ id }), body = DeviceReissueRequest.safeParse(input);
  if (!params.success || !body.success) return { ok: false as const, refresh: true, message: "Refresh setup before replacing configuration." };
  try { return { ok: true as const, data: await apiMutationAction("POST", routes.deviceProvisioning.reissue.path(params.data.id), DeviceProvisioning, body.data) }; }
  catch (error) { return failure("replaceDeviceConfiguration", error); }
}
export async function revokeDeviceCredential(id: unknown, input: unknown) {
  const params = DeviceSetupParams.safeParse({ id }), body = DeviceHandoffRequest.safeParse(input);
  if (!params.success || !body.success) return { ok: false as const, refresh: true, message: "Refresh setup before revoking this identity." };
  try { return { ok: true as const, data: await apiMutationAction("POST", routes.deviceProvisioning.revoke.path(params.data.id), DeviceProvisioning, body.data) }; }
  catch (error) { return failure("revokeDeviceCredential", error); }
}
