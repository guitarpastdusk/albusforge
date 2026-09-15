/**
 * When does the route to the API open?
 *
 * A Cloud Run instance passes its TCP startup probe as soon as the port is
 * open, but on a cold start the NAT-translated route to the public internet
 * isn't usable for some seconds after that — private-range traffic through the
 * VPC already is, so the database answers while the API is still unreachable
 * (ADR 0004: egress is ALL_TRAFFIC through the VPC).
 *
 * This measures that window rather than closing it. Blocking startup on it was
 * tried and removed: on staging the probe timed out for its whole 28 s budget
 * and the instance served anyway, so the wait bought nothing and cost every
 * cold start 28 s — and the container isn't serving while it waits, which may
 * be part of why the route isn't there to find. What actually protects the
 * person's message is the retry stack above this: the transport retries in
 * `callStructured`, intake's hand-back to gateway's retry, and the portal's
 * own chase, together covering minutes rather than seconds.
 *
 * So callers start this after they listen and don't await it. The log line it
 * produces is the only measurement of the window we have.
 */

/** Any HTTP answer proves the route; the status doesn't matter, so the cheapest request will do. */
export const EGRESS_PROBE_URL = "https://api.anthropic.com/";

export interface EgressWait {
  ok: boolean;
  /** Transport attempts made, successful one included. */
  attempts: number;
  waitedMs: number;
  /** The last transport failure's code (`ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`), when it had one. */
  lastCode?: string;
}

export interface EgressOptions {
  url?: string;
  /** Give up after this long and let the caller decide; never block startup indefinitely. */
  budgetMs?: number;
  /** Per attempt. Short: a reachable host answers in well under a second. */
  attemptTimeoutMs?: number;
  /** Test seam, so a wait costs no real time. */
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof globalThis.fetch;
}

/** Long enough to outlast a window nothing has yet measured the end of. */
const DEFAULT_BUDGET_MS = 120_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 3_000;
/** Backoff between attempts; the last value repeats until the budget is spent. */
const BACKOFF_MS = [250, 500, 1_000, 2_000, 3_000];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The first `code` in the error's cause chain: undici's ENOTFOUND, ECONNREFUSED, UND_ERR_*. */
function transportCode(error: unknown): string | undefined {
  for (let current: unknown = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * Retries a HEAD request until one comes back or the budget runs out. Any HTTP
 * response is success — a 404 from the API's root means the packets got there,
 * which is the only question being asked. No credentials are sent, so this
 * can't be mistaken for a metered call.
 */
export async function awaitEgress(options: EgressOptions = {}): Promise<EgressWait> {
  const {
    url = EGRESS_PROBE_URL,
    budgetMs = DEFAULT_BUDGET_MS,
    attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
    sleep = delay,
    fetch = globalThis.fetch,
  } = options;

  const started = Date.now();
  const spent = () => Date.now() - started;
  let attempts = 0;
  let planned = 0;
  let lastCode: string | undefined;

  for (;;) {
    attempts++;
    try {
      await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(attemptTimeoutMs) });
      return { ok: true, attempts, waitedMs: spent(), ...(lastCode === undefined ? {} : { lastCode }) };
    } catch (error) {
      lastCode = transportCode(error) ?? lastCode;
    }
    const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
    // Against the backoff we intended as well as the clock: a caller whose
    // `sleep` returns early (a test's, say) would otherwise never reach the
    // budget, and this loop would run for as long as the route stayed shut.
    planned += backoff;
    if (Math.max(spent(), planned) >= budgetMs) return { ok: false, attempts, waitedMs: spent(), ...(lastCode === undefined ? {} : { lastCode }) };
    await sleep(backoff);
  }
}
