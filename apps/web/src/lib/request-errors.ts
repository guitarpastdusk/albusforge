import "server-only";
import { format } from "node:util";
import type { Instrumentation } from "next";
import { log, traceFromHeaders, type Severity } from "./log";

/*
 * Exactly one ERROR entry per failed request.
 *
 * Next reports a render failure twice: it prints the error with console.error
 * (multi-line, no request context), and it calls instrumentation's
 * onRequestError (with path, method, headers and route). Both carry the same
 * `digest`. register() routes console.error/warn here, and the two paths
 * dedupe by digest, whichever arrives first:
 *
 * - console first: the entry is held for PENDING_MS. onRequestError for the
 *   same digest cancels it and logs the full entry instead. If onRequestError
 *   never comes, the held entry is written, so nothing is lost.
 * - onRequestError first: the digest is remembered for RECENT_MS, and a later
 *   console print of it is dropped.
 */

const PENDING_MS = 2_000;
const RECENT_MS = 60_000;

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const recent = new Map<string, number>();

function digestOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("digest" in value)) return undefined;
  const { digest } = value as { digest: unknown };
  return typeof digest === "string" || typeof digest === "number" ? String(digest) : undefined;
}

function remember(digest: string, now = Date.now()): void {
  for (const [key, expires] of recent) if (expires <= now) recent.delete(key);
  recent.set(digest, now + RECENT_MS);
}

function alreadyLogged(digest: string, now = Date.now()): boolean {
  const expires = recent.get(digest);
  return expires !== undefined && expires > now;
}

export const reportRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const digest = digestOf(error);
  if (digest) {
    const held = pending.get(digest);
    if (held) {
      clearTimeout(held);
      pending.delete(digest);
    } else if (alreadyLogged(digest)) {
      return;
    }
    remember(digest);
  }

  const pathname = request.path.split("?")[0];
  const reason = error instanceof Error ? error.message : String(error);
  log("ERROR", `${request.method} ${pathname} failed: ${reason}`, {
    error,
    trace: traceFromHeaders(request.headers),
    fields: {
      ...(digest ? { digest } : {}),
      // Never the headers: they carry the session cookie.
      request: { method: request.method, path: request.path },
      next: { ...context },
    },
  });
};

// ESC [ … m colour codes, built from a char code so the source has no control character.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** One structured entry for a console.error/console.warn call. */
export function routeConsoleCall(severity: Severity, args: unknown[]): void {
  const error = args.find((arg): arg is Error => arg instanceof Error);
  const rest = args
    .filter((arg) => arg !== error)
    .map((arg) => (typeof arg === "string" ? arg.replace(ANSI, "").trim() : arg))
    .filter((arg) => arg !== "" && arg !== "⨯");
  const text = rest.length > 0 ? format(...rest) : "";
  const message = [text, error ? `${error.name}: ${error.message}` : ""].filter(Boolean).join(" ") || "(empty console call)";

  const digest = digestOf(error);
  const emit = () => log(severity, message, { error, fields: digest ? { digest } : undefined });

  if (!digest) return emit();
  if (alreadyLogged(digest) || pending.has(digest)) return;

  const timer = setTimeout(() => {
    pending.delete(digest);
    remember(digest);
    emit();
  }, PENDING_MS);
  timer.unref?.();
  pending.set(digest, timer);
}

let original: { error: typeof console.error; warn: typeof console.warn } | undefined;

/** Node.js runtime only; called from register(). Idempotent. */
export function routeConsoleToStructuredLog(): void {
  if (original) return;
  original = { error: console.error, warn: console.warn };
  console.error = (...args: unknown[]) => routeConsoleCall("ERROR", args);
  console.warn = (...args: unknown[]) => routeConsoleCall("WARNING", args);
}

/** Tests only. */
export function resetRequestErrorLoggingForTests(): void {
  if (original) {
    console.error = original.error;
    console.warn = original.warn;
    original = undefined;
  }
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
  recent.clear();
}
