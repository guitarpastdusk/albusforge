import type { z } from "zod";
import { fetchTransport, request } from "./core";

/*
 * Browser calls are same-origin: the load balancer sends /v1/* to gateway on
 * every hostname (ADR 0007), so there is no base URL and no CORS.
 *
 * No mock mode here, and no current callers: interactive writes go through
 * Server Functions in src/actions, which use the server client (and so mock
 * mode, the internal token and the cookie allowlist).
 */
const transport = fetchTransport("", {}, "same-origin");

export async function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  return request(transport, "GET", path, schema);
}

export async function apiPost<S extends z.ZodType>(path: string, schema: S, body: unknown): Promise<z.infer<S>> {
  return request(transport, "POST", path, schema, body);
}
