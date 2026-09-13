import { ApiError, type Method } from "@albusforge/schema";
import type { z } from "zod";

/** Gateway answered with the API error shape (404, 401, …). Callers may handle these. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
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
}

/** How a request reaches an answer: over HTTP, or from the mocks. */
export type Transport = (method: Method, path: string, body: unknown) => Promise<TransportResponse>;

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
): Promise<z.infer<S>> {
  const { status, contentType, isJson, json } = await transport(method, path, body);
  const route = `${method} ${path.split("?")[0]}`;

  if (status < 200 || status >= 300) {
    const parsed = isJson ? ApiError.safeParse(json) : undefined;
    if (parsed?.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiRequestError(status, code, message, details);
    }
    throw new GatewayError({ route, status, contentType, reason: "unexpected_status" });
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
  return parsed.data;
}

export function fetchTransport(
  base: string,
  headers: Record<string, string> = {},
  credentials?: RequestCredentials,
): Transport {
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      credentials,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const contentType = res.headers.get("content-type");
    const text = await res.text();

    // An empty body (204) is valid JSON-less success; the schema decides.
    if (text === "") return { status: res.status, contentType, isJson: true, json: null };
    if (!contentType || !/[/+]json\b/i.test(contentType)) {
      return { status: res.status, contentType, isJson: false, json: undefined };
    }
    try {
      return { status: res.status, contentType, isJson: true, json: JSON.parse(text) };
    } catch {
      return { status: res.status, contentType, isJson: false, json: undefined };
    }
  };
}
