/**
 * Errors that mean "the database can't answer right now" rather than "this
 * request or this code is wrong". The routes turn them into a JSON 503, so a
 * stalled or unreachable database reads as unavailable, not as a bug.
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
 * SQLSTATEs: 57014 query_canceled (statement_timeout), 57P01–57P03 server
 * shutting down or not accepting connections, 53300 too many connections.
 */
const UNAVAILABLE_SQLSTATES = new Set(["57014", "57P01", "57P02", "57P03", "53300"]);

/** Checks the error and its `cause` chain: Drizzle wraps pg errors in DrizzleQueryError. */
export function isDatabaseUnavailable(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && (CONNECTION_CODES.has(code) || UNAVAILABLE_SQLSTATES.has(code))) return true;
    if (TIMEOUT_MESSAGES.includes(current.message) || CONNECTION_MESSAGES.includes(current.message)) return true;
  }
  return false;
}
