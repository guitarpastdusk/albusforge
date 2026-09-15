/**
 * Errors that mean "the database can't answer right now" rather than "this
 * request or this code is wrong". The routes turn them into a JSON 503, so a
 * stalled or unreachable database reads as unavailable, not as a bug — and so
 * gateway retries the turn, which is the only thing that answers the message
 * once this request has given up on it.
 */

/** pg-pool and pg messages for the timeouts the gateway configures (createDb options). */
const TIMEOUT_MESSAGES = [
  "timeout exceeded when trying to connect", // pg-pool: no client within connectionTimeoutMillis
  "Connection terminated due to connection timeout", // pg: handshake exceeded connectionTimeoutMillis
  "Query read timeout", // pg: no response within query_timeout
];

const CONNECTION_MESSAGES = ["Connection terminated unexpectedly", "Connection terminated"];

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"]);

/**
 * Our own codes, for the cases no driver reports: a connection that can't be
 * made reusable inside the response budget (`ClientDbCleanupError`), and a
 * turn that ran out of budget with database work still outstanding. Matched by
 * code, not by class, so a bundled copy of either package still classifies.
 */
const UNAVAILABLE_CODES = new Set(["DB_CLEANUP_TIMEOUT", "DB_CLEANUP_FAILED", "DB_BUDGET_EXCEEDED"]);

/**
 * SQLSTATEs: 57014 query_canceled (statement_timeout), 57P01–57P03 server
 * shutting down or not accepting connections, 53300 too many connections.
 */
const UNAVAILABLE_SQLSTATES = new Set(["57014", "57P01", "57P02", "57P03", "53300"]);

/**
 * The turn gave up before the caller's attempt budget ran out, with the
 * connection destroyed rather than left holding a lock. Carries a code
 * `isDatabaseUnavailable` knows, so the route answers 503 and gateway's
 * retry — which is what this failure is handing the work to — actually runs.
 */
export class DatabaseUnavailableError extends Error {
  override readonly name = "DatabaseUnavailableError";
  readonly code = "DB_BUDGET_EXCEEDED";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * The turn failed in a way another attempt could fix — the model API was
 * unreachable, or something threw — and the caller said it would retry
 * (`may_retry`). Nothing is written, the route answers 503, and gateway's
 * retry answers the message. Without a retry ahead of it the turn writes its
 * fallback reply instead, so a message is never left unanswered.
 */
export class TurnRetryableError extends Error {
  override readonly name = "TurnRetryableError";
  readonly code = "TURN_RETRYABLE";

  constructor(
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`the turn failed with ${reason}; the caller retries this`, options);
  }
}

/** Checks the error and its `cause` chain: Drizzle wraps pg errors in DrizzleQueryError. */
export function isDatabaseUnavailable(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && (CONNECTION_CODES.has(code) || UNAVAILABLE_SQLSTATES.has(code) || UNAVAILABLE_CODES.has(code))) return true;
    if (TIMEOUT_MESSAGES.includes(current.message) || CONNECTION_MESSAGES.includes(current.message)) return true;
  }
  return false;
}
