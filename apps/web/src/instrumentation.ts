import type { Instrumentation } from "next";

/**
 * Runs once when the server starts, before it handles requests.
 *
 * - Routes console.error/warn through the structured logger, so Next's own
 *   error prints become one JSON line each (lib/request-errors.ts).
 * - Validates runtime config. Invalid config, including mock data on Cloud
 *   Run, stops the process here instead of surfacing as 500s.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { routeConsoleToStructuredLog } = await import("./lib/request-errors");
  routeConsoleToStructuredLog();
  const { validateRuntimeConfigOrExit } = await import("./lib/startup");
  validateRuntimeConfigOrExit(process.env);
}

/** One ERROR entry per failed request, with its path, route, digest and trace. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("./lib/request-errors");
  await reportRequestError(error, request, context);
};
