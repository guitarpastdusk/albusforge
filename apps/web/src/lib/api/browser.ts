import type { z } from "zod";
import { fetchTransport, request } from "./core";

/*
 * Browser calls are same-origin: the load balancer sends /v1/* to gateway on
 * every hostname (ADR 0007), so there is no base URL and no CORS.
 *
 * No mock mode here. Nothing in the browser calls the API yet; when the first
 * client-side call lands, add a dev-only /v1 handler that serves src/mocks.
 */
const transport = fetchTransport("", {}, "same-origin");

export async function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  return request(transport, "GET", path, schema);
}

export async function apiPost<S extends z.ZodType>(path: string, schema: S, body: unknown): Promise<z.infer<S>> {
  return request(transport, "POST", path, schema, body);
}
