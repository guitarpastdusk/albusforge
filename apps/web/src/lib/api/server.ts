import "server-only";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { z } from "zod";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { ApiRequestError, fetchTransport, request, type Transport } from "./core";
import { nextCookieWriter } from "./cookies";
import { gatewayHeaders } from "./gateway-headers.server";
import { idToken } from "./id-token.server";
import { createSessionClient, type SessionClient } from "./session-client";

/** `none` skips the ID token — for a gateway running locally without auth. */
function internalAuth(): "metadata" | "none" {
  const auth = process.env.GATEWAY_INTERNAL_AUTH ?? "metadata";
  if (auth === "metadata" || auth === "none") return auth;
  throw new Error(`GATEWAY_INTERNAL_AUTH must be "metadata" or "none", got "${auth}"`);
}

/** A transport whose upstream Cookie header comes from `cookieHeader` (filtered to the allowlist). */
async function transportFor(cookieHeader: string | null): Promise<Transport> {
  // Render per request. Nothing environment-specific may be baked in at build
  // time: the image promoted to prod is the one staging ran (ADR 0001). This
  // also means `next build` never fetches, so CI needs no gateway.
  await connection();

  // Validated at startup by instrumentation.ts; re-checked here so no request
  // can take the mock path on Cloud Run even if startup validation is bypassed.
  const { apiMode, trustedProxyHops } = loadRuntimeConfig(process.env);

  if (apiMode === "mock") {
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
        cookie: cookieHeader,
      },
      token,
      trustedProxyHops,
    ),
  );
}

async function transport(): Promise<Transport> {
  return transportFor((await headers()).get("cookie"));
}

export async function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  return request(await transport(), "GET", path, schema);
}

export async function apiPost<S extends z.ZodType>(path: string, schema: S, body: unknown): Promise<z.infer<S>> {
  return request(await transport(), "POST", path, schema, body);
}

/**
 * Server Functions only (cookies can only be written there). Mutations relay
 * gateway's `__Host-albus_session` / `__Host-albus_anon` cookies to the browser
 * and use them for the client's own follow-up calls. See lib/api/README.md.
 */
export async function sessionClient(): Promise<SessionClient> {
  const incoming = await headers();
  return createSessionClient({
    transportFor,
    cookieHeader: incoming.get("cookie"),
    writer: nextCookieWriter(await cookies()),
  });
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
