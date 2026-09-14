"use server";
import {
  TelemetryDeviceParams,
  TelemetryMetadata,
  TelemetryMetadataRequest,
  routes,
} from "@albusforge/schema";
import { ApiRequestError } from "@/lib/api/core";
import { apiMutationAction } from "@/lib/api/server";
import { actionFailure } from "@/lib/action-errors";

export async function renameTelemetryDevice(
  id: unknown,
  name: unknown,
  version: unknown,
) {
  const params = TelemetryDeviceParams.safeParse({ id });
  const body = TelemetryMetadataRequest.safeParse({
    display_name: typeof name === "string" ? name.trim() || null : name,
    expected_version: version,
  });
  if (!params.success || !body.success)
    return {
      ok: false as const,
      message: "Use a name of at most 80 characters.",
      refresh: false,
    };
  try {
    const data = await apiMutationAction(
      "PATCH",
      routes.telemetry.metadata.path(params.data.id),
      TelemetryMetadata,
      body.data,
    );
    return { ok: true as const, data };
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      [401, 403, 404, 409].includes(error.status)
    )
      return {
        ok: false as const,
        refresh: true,
        message:
          error.status === 409
            ? "Someone changed this name. Refresh to see the current value before editing again."
            : "Your current access does not allow this edit. Refresh to check your session and permissions.",
      };
    await actionFailure(
      "renameTelemetryDevice",
      error,
      "The name save could not be confirmed.",
    );
    return {
      ok: false as const,
      refresh: true,
      message:
        "The save could not be confirmed. Refresh the device before trying again.",
    };
  }
}
