import "server-only";
import { format } from "node:util";
import type { Instrumentation } from "next";
import { log, traceFromHeaders, type Severity } from "./log";

/*
 * One ERROR entry per failed request, each with its own trace.
 *
 * Next reports a render failure twice: it prints the error with console.error
 * (multi-line, no request context), and it calls instrumentation's
 * onRequestError (with path, method, headers and route). Both carry the same
 * `digest`.
 *
 * A digest is a hash of the error's message and stack, not a request ID.
 * Every request that fails the same way shares it. So nothing here suppresses
 * by digest over a time window. onRequestError is authoritative and always
 * logs. The only thing ever dropped is Next's console copy, and only by
 * pairing it 1:1 with an onRequestError for the same digest:
 *
 * - Console copy first: it is queued for `holdMs`. An onRequestError for that
 *   digest cancels exactly one queued copy. A copy still unmatched when its
 *   hold expires is logged as-is, without a trace.
 * - onRequestError first: it logs, and leaves one credit for that digest. The
 *   credit cancels exactly one console copy arriving within `holdMs`, then
 *   expires.
 *
 * N concurrent failures with one digest give N entries, each with its own
 * trace, and cancel at most N console copies. When a cap is hit, the console
 * copy is emitted rather than held, so an entry is never lost. The cost is a
 * rare duplicate.
 */

export interface RequestErrorLoggerOptions {
  /** How long an unpaired console copy or credit waits for its partner. */
  holdMs?: number;
  /** Queued console copies plus credits for one digest. */
  maxPerDigest?: number;
  /** Queued console copies plus credits across all digests. */
  maxTotal?: number;
}

type Timer = ReturnType<typeof setTimeout>;

interface DigestState {
  /** Console copies waiting for an onRequestError. */
  held: Timer[];
  /** onRequestError credits waiting for a console copy. */
  credits: Timer[];
}

function digestOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("digest" in value)) return undefined;
  const { digest } = value as { digest: unknown };
  return typeof digest === "string" || typeof digest === "number" ? String(digest) : undefined;
}

// ESC [ … m colour codes, built from a char code so the source has no control character.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function consoleMessage(args: unknown[], error: Error | undefined): string {
  const rest = args
    .filter((arg) => arg !== error)
    .map((arg) => (typeof arg === "string" ? arg.replace(ANSI, "").trim() : arg))
    .filter((arg) => arg !== "" && arg !== "⨯");
  const text = rest.length > 0 ? format(...rest) : "";
  return [text, error ? `${error.name}: ${error.message}` : ""].filter(Boolean).join(" ") || "(empty console call)";
}

export function createRequestErrorLogger({ holdMs = 2_000, maxPerDigest = 50, maxTotal = 1_000 }: RequestErrorLoggerOptions = {}) {
  const states = new Map<string, DigestState>();
  let total = 0;
  // Next may report one thrown error more than once for the same request (the
  // RSC and HTML passes). Same object, same request, so log it once. Objects
  // from different requests are distinct, so this never crosses requests.
  const reported = new WeakSet<object>();

  const stateFor = (digest: string): DigestState => {
    let state = states.get(digest);
    if (!state) {
      state = { held: [], credits: [] };
      states.set(digest, state);
    }
    return state;
  };

  const release = (digest: string, list: "held" | "credits", timer: Timer): void => {
    const state = states.get(digest);
    if (!state) return;
    const index = state[list].indexOf(timer);
    if (index === -1) return;
    state[list].splice(index, 1);
    total -= 1;
    if (state.held.length === 0 && state.credits.length === 0) states.delete(digest);
  };

  const hasRoom = (state: DigestState) => total < maxTotal && state.held.length + state.credits.length < maxPerDigest;

  const reportRequestError: Instrumentation.onRequestError = (error, request, context) => {
    if (typeof error === "object" && error !== null) {
      if (reported.has(error)) return;
      reported.add(error);
    }

    const digest = digestOf(error);
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

    if (!digest) return;
    const state = stateFor(digest);

    // Pair with the oldest console copy already waiting, if any.
    const held = state.held[0];
    if (held) {
      clearTimeout(held);
      release(digest, "held", held);
      return;
    }

    // Otherwise leave one credit for the console copy that follows. At a cap,
    // skip the credit: the later copy is then logged, a duplicate but no loss.
    if (!hasRoom(state)) {
      if (state.held.length === 0 && state.credits.length === 0) states.delete(digest);
      return;
    }
    const credit: Timer = setTimeout(() => release(digest, "credits", credit), holdMs);
    credit.unref?.();
    state.credits.push(credit);
    total += 1;
  };

  /** One structured entry for a console.error/console.warn call. */
  const routeConsoleCall = (severity: Severity, args: unknown[]): void => {
    const error = args.find((arg): arg is Error => arg instanceof Error);
    const digest = digestOf(error);
    const emit = () =>
      log(severity, consoleMessage(args, error), { error, fields: digest ? { digest } : undefined });

    if (!digest) return emit();
    const state = stateFor(digest);

    // An onRequestError already logged this failure: spend its credit.
    const credit = state.credits[0];
    if (credit) {
      clearTimeout(credit);
      release(digest, "credits", credit);
      return;
    }

    // At a cap, emit now rather than hold (or drop).
    if (!hasRoom(state)) {
      if (state.held.length === 0 && state.credits.length === 0) states.delete(digest);
      return emit();
    }

    const held: Timer = setTimeout(() => {
      release(digest, "held", held);
      emit();
    }, holdMs);
    held.unref?.();
    state.held.push(held);
    total += 1;
  };

  const reset = (): void => {
    for (const state of states.values()) for (const timer of [...state.held, ...state.credits]) clearTimeout(timer);
    states.clear();
    total = 0;
  };

  /** Held copies plus credits, for tests and bounds checks. */
  const pendingCount = (): number => total;

  return { reportRequestError, routeConsoleCall, reset, pendingCount };
}

const shared = createRequestErrorLogger();

export const reportRequestError = shared.reportRequestError;
export const routeConsoleCall = shared.routeConsoleCall;

let original: { error: typeof console.error; warn: typeof console.warn } | undefined;

/** Node.js runtime only; called from register(). Idempotent. */
export function routeConsoleToStructuredLog(): void {
  if (original) return;
  original = { error: console.error, warn: console.warn };
  console.error = (...args: unknown[]) => shared.routeConsoleCall("ERROR", args);
  console.warn = (...args: unknown[]) => shared.routeConsoleCall("WARNING", args);
}

/** Tests only. */
export function resetRequestErrorLoggingForTests(): void {
  if (original) {
    console.error = original.error;
    console.warn = original.warn;
    original = undefined;
  }
  shared.reset();
}
