import { ApiError, type Method } from "@albusforge/schema";
import type { z } from "zod";

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

export interface TransportResponse {
  status: number;
  json: unknown;
}

/** How a request reaches an answer: over HTTP, or from the mocks. */
export type Transport = (method: Method, path: string, body: unknown) => Promise<TransportResponse>;

/** Send one request and validate the answer — success against `schema`, failure against ApiError. */
export async function request<S extends z.ZodType>(
  transport: Transport,
  method: Method,
  path: string,
  schema: S,
  body?: unknown,
): Promise<z.infer<S>> {
  const { status, json } = await transport(method, path, body);

  if (status < 200 || status >= 300) {
    const parsed = ApiError.safeParse(json);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiRequestError(status, code, message, details);
    }
    throw new ApiRequestError(status, "unexpected_response", `${method} ${path} failed with ${status}`);
  }

  return schema.parse(json);
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

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // Not JSON (an HTML error page from a proxy, say); request() reports the status.
      }
    }
    return { status: res.status, json };
  };
}
