/**
 * Runs once when the server starts. Invalid runtime configuration — including
 * mock data on Cloud Run — stops the process here instead of surfacing as 500s.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateRuntimeConfigOrExit } = await import("./lib/startup");
  validateRuntimeConfigOrExit(process.env);
}
