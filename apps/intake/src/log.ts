/*
 * Structured logs: one JSON object per line on stdout, in the shape Cloud
 * Logging parses from a Cloud Run container — `severity`, `message`, extra
 * fields, and the special `logging.googleapis.com/*` trace fields.
 *
 * The same conventions as apps/web/src/lib/log.ts (trace from
 * X-Cloud-Trace-Context, then W3C traceparent; the trace field only when
 * GOOGLE_CLOUD_PROJECT is set). A shared package can replace both copies once a
 * third service needs it.
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

export type Log = (severity: Severity, message: string, options?: LogOptions) => void;

type Headers = Readonly<Record<string, string | string[] | undefined>>;

const TRACE_FIELD = "logging.googleapis.com/trace";
const SPAN_FIELD = "logging.googleapis.com/spanId";
const SAMPLED_FIELD = "logging.googleapis.com/trace_sampled";
const MAX_SPAN = 2n ** 64n;

const isAllZero = (hex: string) => /^0+$/.test(hex);

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

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
export function traceFromHeaders(headers: Headers): TraceContext | undefined {
  return parseCloudTraceContext(header(headers, "x-cloud-trace-context")) ?? parseTraceparent(header(headers, "traceparent"));
}

/**
 * Marks an error whose message is operator-authored — a config or startup
 * failure naming environment variables — so the logger may keep it.
 */
export function safeToLog<E extends Error>(error: E): E {
  Object.defineProperty(error, "safeToLog", { value: true, enumerable: false });
  return error;
}

const isSafeToLog = (error: unknown): boolean => (error as { safeToLog?: unknown } | null)?.safeToLog === true;

/** Stack frames only: file, line and function, never the `Error: message` header. */
const MAX_FRAMES = 5;

function frames(error: Error): string[] {
  return (error.stack ?? "")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .slice(0, MAX_FRAMES)
    .map((line) => line.trim());
}

/**
 * Errors have no enumerable fields; spell out what is worth keeping — and no
 * more than that. An error's message can carry anything the code that threw it
 * had in hand: an excerpt of a model response, a row, a query, a person's
 * words. The allowlist is the class name, the codes that classify it, and the
 * stack's frames. `message` (and the stack's header line, which repeats it)
 * survives only for errors marked `safeToLog`.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: typeof error, redacted: true };

  const serialized: Record<string, unknown> = { name: error.name };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") serialized.code = code;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") serialized.status = status;
  if (isSafeToLog(error)) serialized.message = error.message;
  else serialized.redacted = true;
  const stack = frames(error);
  if (stack.length > 0) serialized.frames = stack;
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
 * a project; without the project it is omitted, never guessed.
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

  // The serialized error carries its own frames; a raw `stack` would repeat
  // the message header the allowlist just dropped.
  if (error !== undefined) entry.error = serializeError(error);

  if (trace && project) {
    entry[TRACE_FIELD] = `projects/${project}/traces/${trace.traceId}`;
    if (trace.spanId) entry[SPAN_FIELD] = trace.spanId;
    if (trace.sampled !== undefined) entry[SAMPLED_FIELD] = trace.sampled;
  }

  return `${safeStringify(entry)}\n`;
}

export interface LoggerOptions {
  /** Defaults to GOOGLE_CLOUD_PROJECT. */
  project?: string;
  /** Defaults to stdout. */
  write?: (line: string) => void;
}

export function createLogger({ project = process.env.GOOGLE_CLOUD_PROJECT, write }: LoggerOptions = {}): Log {
  const out = write ?? ((line: string) => void process.stdout.write(line));
  return (severity, message, options) => out(formatLogLine(severity, message, options, project));
}
