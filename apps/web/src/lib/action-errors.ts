import "server-only";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { log, traceFromHeaders } from "./log";

export const SERVICE_UNAVAILABLE_MESSAGE = "We can’t reach the service right now. Try again in a moment.";

/**
 * A Server Function's failure as a value, logged once. Actions return their
 * errors instead of throwing, so onRequestError never sees them: this is the
 * single ERROR entry for the failure, with the request's trace.
 */
export async function actionFailure(
  action: string,
  error: unknown,
  message = SERVICE_UNAVAILABLE_MESSAGE,
): Promise<{ ok: false; message: string }> {
  unstable_rethrow(error);
  const reason = error instanceof Error ? error.message : String(error);
  log("ERROR", `action ${action} failed: ${reason}`, {
    error,
    trace: traceFromHeaders(await headers()),
    fields: { action },
  });
  return { ok: false, message };
}

/**
 * The upstream call succeeded but the outcome is incomplete (e.g. verify
 * returned no session cookie). Logged once, without any credential values.
 */
export async function actionIncomplete(action: string, reason: string, message: string): Promise<{ ok: false; message: string }> {
  log("ERROR", `action ${action} incomplete: ${reason}`, {
    trace: traceFromHeaders(await headers()),
    fields: { action },
  });
  return { ok: false, message };
}
