"use server";
import { FirmwareRequest, FirmwareRetryRequest } from "@albusforge/schema";
import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { apiMutationAction } from "@/lib/api/server";
import { ApiRequestError } from "@/lib/api/core";
const Version = z.strictObject({ version: z.number().int().positive() });
export async function requestFirmware(
  buildId: string,
  input: unknown,
): Promise<{ ok: boolean; message: string }> {
  const body = FirmwareRequest.safeParse(input);
  if (!z.uuid().safeParse(buildId).success || !body.success)
    return {
      ok: false,
      message: "Invalid firmware request. Refresh this page.",
    };
  try {
    await apiMutationAction(
      "POST",
      `/v1/builds/${buildId}/code`,
      Version,
      body.data,
    );
    return {
      ok: true,
      message: "Firmware compile queued. Refresh to check progress.",
    };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiRequestError)
      return { ok: false, message: error.message };
    return {
      ok: false,
      message:
        "Compile request outcome is uncertain. Refresh before requesting again.",
    };
  }
}
export async function retryFirmware(
  buildId: string,
  version: number,
  tenantId: string,
): Promise<{ ok: boolean; message: string }> {
  const body = FirmwareRetryRequest.safeParse({ tenant_id: tenantId });
  if (
    !body.success ||
    !z.uuid().safeParse(buildId).success ||
    !Number.isInteger(version) ||
    version < 1
  )
    return { ok: false, message: "Invalid retry request." };
  try {
    await apiMutationAction(
      "POST",
      `/v1/builds/${buildId}/code/${version}/retry`,
      Version,
      body.data,
    );
    return { ok: true, message: "Retry queued. Refresh to check progress." };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiRequestError)
      return { ok: false, message: error.message };
    return {
      ok: false,
      message: "Retry outcome is uncertain. Refresh this page.",
    };
  }
}
