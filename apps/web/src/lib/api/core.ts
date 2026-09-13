import { ApiError, type Method } from "@albusforge/schema";
import type { z } from "zod";

/** Gateway answered with the API error shape (404, 401, …). Callers may handle these. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Gateway's 501: the route exists in the contract but isn't built yet. */
export function isNotImplemented(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 501;
}

export type GatewayErrorReason = "not_json" | "schema_mismatch" | "unexpected_status";

export interface GatewayErrorDetails {
  /** "GET /v1/me" — method and path, no query string. */
  route: string;
  status: number;
  contentType: string | null;
  reason: GatewayErrorReason;
  /** Short zod issue summary, for schema_mismatch. */
  issues?: string;
  retryAfterSeconds?: number;
}

/**
 * Something answered, but not with the API contract: HTML from a placeholder,
 * JSON of the wrong shape, or a failure without the error shape.
 *
 * Thrown, never logged here. The request's error boundary renders, and
 * instrumentation's onRequestError logs it once, with the request's trace.
 */
export class GatewayError extends Error {
  readonly details: GatewayErrorDetails;

  constructor(details: GatewayErrorDetails) {
    super(describe(details));
    this.name = "GatewayError";
    this.details = details;
  }

  /** Picked up by lib/log's error serializer. */
  toLogFields(): { gateway: GatewayErrorDetails } {
    return { gateway: this.details };
  }
}

function describe({ route, status, contentType, reason, issues }: GatewayErrorDetails): string {
  switch (reason) {
    case "not_json":
      return `${route} returned ${status} ${contentType ?? "with no content type"}, expected application/json`;
    case "schema_mismatch":
      return `${route} returned JSON that does not match the schema: ${issues ?? "unknown issues"}`;
    case "unexpected_status":
      return `${route} returned ${status} ${contentType ?? "with no content type"} without the API error shape`;
  }
}

/** "tenant: Invalid input; user.email: Invalid email (+2 more)" */
export function summarizeIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>, max = 3): string {
  const shown = issues
    .slice(0, max)
    .map(({ path, message }) => `${path.length > 0 ? path.map(String).join(".") : "(root)"}: ${message}`);
  const more = issues.length - max;
  return more > 0 ? `${shown.join("; ")} (+${more} more)` : shown.join("; ");
}

export interface TransportResponse {
  status: number;
  contentType: string | null;
  /** False when the body is not JSON (wrong content type, or it didn't parse). */
  isJson: boolean;
  json: unknown;
  /** Raw Set-Cookie lines, when the transport has them. Only Server Functions relay any (lib/api/cookies.ts). */
  setCookies?: readonly string[];
  /** Sanitized Retry-After delay; no raw response header is exposed. */
  retryAfterSeconds?: number;
}

/**
 * How a request reaches an answer: over HTTP, or from the mocks. Aborting
 * `signal` cancels the request, including reading its body.
 */
export type Transport = (method: Method, path: string, body: unknown, signal?: AbortSignal) => Promise<TransportResponse>;

/**
 * Send one request and validate the answer. A 2xx must be JSON that matches
 * `schema`; a non-2xx must carry the API error shape. Anything else is a
 * GatewayError.
 */
export async function request<S extends z.ZodType>(
  transport: Transport,
  method: Method,
  path: string,
  schema: S,
  body?: unknown,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  return (await requestWithCookies(transport, method, path, schema, body, signal)).data;
}

/** `request`, also returning the response's Set-Cookie lines (for Server Functions to relay). */
export async function requestWithCookies<S extends z.ZodType>(
  transport: Transport,
  method: Method,
  path: string,
  schema: S,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ data: z.infer<S>; setCookies: readonly string[] }> {
  const { status, contentType, isJson, json, setCookies = [], retryAfterSeconds } = await transport(method, path, body, signal);
  const route = `${method} ${path.split("?")[0]}`;

  if (status < 200 || status >= 300) {
    const parsed = isJson ? ApiError.safeParse(json) : undefined;
    if (parsed?.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiRequestError(status, code, message, details, retryAfterSeconds);
    }
    throw new GatewayError({ route, status, contentType, reason: "unexpected_status", ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) });
  }

  if (!isJson) throw new GatewayError({ route, status, contentType, reason: "not_json" });

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new GatewayError({
      route,
      status,
      contentType,
      reason: "schema_mismatch",
      issues: summarizeIssues(parsed.error.issues),
    });
  }
  return { data: parsed.data, setCookies };
}

export function fetchTransport(
  base: string,
  headers: Record<string, string> = {},
  credentials?: RequestCredentials,
): Transport {
  return async (method, path, body, signal) => {
    const res = await fetch(base + path, {
      method,
      credentials,
      signal,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const contentType = res.headers.get("content-type");
    const setCookies = res.headers.getSetCookie();
    const retryAfterSeconds = parseRetryAfter(res.headers.get("retry-after"), Date.now());
    const retry = retryAfterSeconds === undefined ? {} : { retryAfterSeconds };
    const text = await res.text();

    // An empty body (204) is valid JSON-less success; the schema decides.
    if (text === "") return { status: res.status, contentType, isJson: true, json: null, setCookies, ...retry };
    if (!contentType || !/[/+]json\b/i.test(contentType)) {
      return { status: res.status, contentType, isJson: false, json: undefined, setCookies, ...retry };
    }
    try {
      return { status: res.status, contentType, isJson: true, json: JSON.parse(text), setCookies, ...retry };
    } catch {
      return { status: res.status, contentType, isJson: false, json: undefined, setCookies, ...retry };
    }
  };
}

/** RFC delta-seconds or HTTP-date; reject malformed/unrepresentable delays. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  let seconds: number;
  if (/^\d+$/.test(trimmed)) seconds = Number(trimmed);
  else if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) {
    seconds = Math.max(0, Math.ceil((Date.parse(trimmed) - now) / 1000));
  } else return undefined;
  // Bound metadata and deadline arithmetic without manufacturing a shorter
  // retry window. Unsupported values fall back to the non-countdown message.
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 31_536_000 ? seconds : undefined;
}
