import "server-only";

/*
 * Structured server logs: one JSON object per line on stdout, in the shape
 * Cloud Logging parses from a Cloud Run container — `severity`, `message`,
 * any extra fields, and the special `logging.googleapis.com/*` trace fields.
 *
 * A stack is a single `stack` string. JSON escapes its newlines, so one log
 * call is always exactly one line, and Cloud Logging shows one entry.
 */

export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface TraceContext {
  /** 32 lowercase hex characters. */
  traceId: string;
  /** 16 lowercase hex characters, when known. */
  spanId?: string;
  sampled?: boolean;
}

export interface LogOptions {
  error?: unknown;
  trace?: TraceContext;
  fields?: Record<string, unknown>;
}

type HeaderSource =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | string[] | undefined>>;

const TRACE_FIELD = "logging.googleapis.com/trace";
const SPAN_FIELD = "logging.googleapis.com/spanId";
const SAMPLED_FIELD = "logging.googleapis.com/trace_sampled";
const MAX_SPAN = 2n ** 64n;

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (typeof headers.get === "function") return (headers as { get(name: string): string | null }).get(name) ?? undefined;
  const value = (headers as Readonly<Record<string, string | string[] | undefined>>)[name];
  return Array.isArray(value) ? value[0] : value;
}

const isAllZero = (hex: string) => /^0+$/.test(hex);

/** `X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=1` — span is decimal, `/SPAN_ID` and `;o=` optional. */
export function parseCloudTraceContext(value: string | undefined): TraceContext | undefined {
  const match = /^([0-9a-f]{32})(?:\/(\d{1,20}))?(?:;o=([01]))?$/i.exec(value?.trim() ?? "");
  if (!match) return undefined;

  const traceId = match[1]!.toLowerCase();
  if (isAllZero(traceId)) return undefined;

  const context: TraceContext = { traceId };
  if (match[2] !== undefined) {
    const span = BigInt(match[2]);
    if (span > 0n && span < MAX_SPAN) context.spanId = span.toString(16).padStart(16, "0");
  }
  if (match[3] !== undefined) context.sampled = match[3] === "1";
  return context;
}

/** W3C `traceparent: VERSION-TRACE_ID-PARENT_ID-FLAGS`. */
export function parseTraceparent(value: string | undefined): TraceContext | undefined {
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(value?.trim().toLowerCase() ?? "");
  if (!match) return undefined;

  const [, version, traceId, spanId, flags] = match as unknown as [string, string, string, string, string];
  if (version === "ff" || isAllZero(traceId) || isAllZero(spanId)) return undefined;
  return { traceId, spanId, sampled: (Number.parseInt(flags, 16) & 1) === 1 };
}

/** Cloud Run's `X-Cloud-Trace-Context` first; W3C `traceparent` if that is absent or malformed. */
export function traceFromHeaders(headers: HeaderSource): TraceContext | undefined {
  return (
    parseCloudTraceContext(readHeader(headers, "x-cloud-trace-context")) ??
    parseTraceparent(readHeader(headers, "traceparent"))
  );
}

/** Errors have no enumerable fields; spell out what is worth keeping. */
export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { value: typeof error === "string" ? error : safeStringify(error) };

  const serialized: Record<string, unknown> = { name: error.name, message: error.message };
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest === "string" || typeof digest === "number") serialized.digest = String(digest);

  const toLogFields = (error as { toLogFields?: unknown }).toLogFields;
  if (typeof toLogFields === "function") Object.assign(serialized, toLogFields.call(error));

  if (error.cause !== undefined) serialized.cause = serializeError(error.cause);
  return serialized;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, current: unknown) => {
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) return "[Circular]";
      seen.add(current);
    }
    return current;
  });
}

/**
 * One log line, newline-terminated. The trace field needs both a trace ID and
 * GOOGLE_CLOUD_PROJECT; without the project it is omitted, never guessed.
 */
export function formatLogLine(
  severity: Severity,
  message: string,
  { error, trace, fields }: LogOptions = {},
  project: string | undefined = process.env.GOOGLE_CLOUD_PROJECT,
): string {
  // severity and message stay first and can't be overwritten by fields.
  const entry: Record<string, unknown> = { severity, message, ...fields };
  entry.severity = severity;
  entry.message = message;

  if (error !== undefined) {
    entry.error = serializeError(error);
    if (error instanceof Error && error.stack) entry.stack = error.stack;
  }

  if (trace && project) {
    entry[TRACE_FIELD] = `projects/${project}/traces/${trace.traceId}`;
    if (trace.spanId) entry[SPAN_FIELD] = trace.spanId;
    if (trace.sampled !== undefined) entry[SAMPLED_FIELD] = trace.sampled;
  }

  return `${safeStringify(entry)}\n`;
}

/** Writes straight to stdout — never through console, which register() routes back here. */
export function log(severity: Severity, message: string, options?: LogOptions): void {
  process.stdout.write(formatLogLine(severity, message, options));
}
