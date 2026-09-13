import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { z } from "zod";
import { ApiRequestError, fetchTransport, request, type Transport } from "./core";
import { gatewayHeaders } from "./gateway-headers.server";
import { idToken } from "./id-token.server";

export type ApiMode = "mock" | "live";

export function apiMode(): ApiMode {
  const mode = process.env.API_MODE;
  if (mode === "mock" || mode === "live") return mode;
  if (mode) throw new Error(`API_MODE must be "mock" or "live", got "${mode}"`);
  return process.env.NODE_ENV === "production" ? "live" : "mock";
}

/** `none` skips the ID token — for a gateway running locally without auth. */
function internalAuth(): "metadata" | "none" {
  const auth = process.env.GATEWAY_INTERNAL_AUTH ?? "metadata";
  if (auth === "metadata" || auth === "none") return auth;
  throw new Error(`GATEWAY_INTERNAL_AUTH must be "metadata" or "none", got "${auth}"`);
}

async function transport(): Promise<Transport> {
  // Render per request. Nothing environment-specific may be baked in at build
  // time: the image promoted to prod is the one staging ran (ADR 0001).
  await connection();

  if (apiMode() === "mock") {
    const { mockTransport } = await import("@/mocks");
    return mockTransport;
  }

  // Internal run.app URL over the VPC — never the public domain (ADR 0007).
  const base = process.env.GATEWAY_INTERNAL_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("GATEWAY_INTERNAL_URL is required when API_MODE=live");

  const incoming = await headers();
  const token = internalAuth() === "metadata" ? await idToken(base) : null;

  return fetchTransport(
    base,
    gatewayHeaders(
      {
        host: incoming.get("host"),
        forwardedFor: incoming.get("x-forwarded-for"),
        cookie: incoming.get("cookie"),
      },
      token,
    ),
  );
}

export async function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  return request(await transport(), "GET", path, schema);
}

export async function apiPost<S extends z.ZodType>(path: string, schema: S, body: unknown): Promise<z.infer<S>> {
  return request(await transport(), "POST", path, schema, body);
}

/** Await an API call; a 404 renders the route's not-found page. */
export async function orNotFound<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }
}
