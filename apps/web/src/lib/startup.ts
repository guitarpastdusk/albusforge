import { log as writeLog } from "./log";
import { loadRuntimeConfig, type RuntimeConfig } from "./runtime-config";

type Env = Record<string, string | undefined>;

/**
 * Validate runtime config at server startup; on failure log and exit(1).
 *
 * Throwing from instrumentation's register() is not enough: Next logs "Failed
 * to prepare server" and keeps listening, answering every request with 500.
 * Cloud Run would count that revision as started. Exiting fails the revision
 * instead, so traffic stays on the previous one.
 *
 * Node-only (process.exit); instrumentation.ts imports it dynamically.
 */
export function validateRuntimeConfigOrExit(
  env: Env,
  exit: (code: number) => never = (code) => process.exit(code),
  log: (message: string) => void = (message) => writeLog("CRITICAL", message),
): RuntimeConfig {
  try {
    return loadRuntimeConfig(env);
  } catch (error) {
    log(`Refusing to start: ${error instanceof Error ? error.message : String(error)}`);
    return exit(1);
  }
}
