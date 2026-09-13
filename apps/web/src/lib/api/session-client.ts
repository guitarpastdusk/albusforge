import type { Method } from "@albusforge/schema";
import type { z } from "zod";
import { applyRelays, mergeCookieHeader, relayableCookies, type CookieWriter } from "./cookies";
import { request, requestWithCookies, type Transport } from "./core";

/**
 * An API client for one Server Function invocation. Mutations relay gateway's
 * credential cookies to the browser and carry them into this client's own
 * follow-up calls. No Next.js imports: `server.ts` wires it to `cookies()`.
 */
export interface SessionClient {
  /** `signal` aborts the read, headers and body alike. */
  get<S extends z.ZodType>(path: string, schema: S, options?: { signal?: AbortSignal }): Promise<z.infer<S>>;
  mutate<S extends z.ZodType>(method: Method, path: string, schema: S, body?: unknown): Promise<z.infer<S>>;
  /** Whether a mutation set or deleted this credential cookie. Never exposes its value. */
  credentialChange(name: string): "set" | "deleted" | undefined;
}

export function createSessionClient({
  transportFor,
  cookieHeader,
  writer,
  now = () => new Date(),
}: {
  /** A transport whose upstream Cookie header is built from `cookieHeader` (and filtered to the allowlist). */
  transportFor: (cookieHeader: string | null) => Transport | Promise<Transport>;
  cookieHeader: string | null;
  writer: CookieWriter;
  now?: () => Date;
}): SessionClient {
  let cookies = cookieHeader;
  const changes = new Map<string, "set" | "deleted">();

  return {
    async get<S extends z.ZodType>(path: string, schema: S, options?: { signal?: AbortSignal }) {
      return request(await transportFor(cookies), "GET", path, schema, undefined, options?.signal);
    },

    async mutate<S extends z.ZodType>(method: Method, path: string, schema: S, body?: unknown) {
      const { data, setCookies } = await requestWithCookies(await transportFor(cookies), method, path, schema, body);
      const relays = relayableCookies(setCookies, now());
      applyRelays(relays, writer);
      cookies = mergeCookieHeader(cookies, relays);
      for (const relay of relays) changes.set(relay.name, relay.kind === "set" ? "set" : "deleted");
      return data;
    },

    credentialChange: (name) => changes.get(name),
  };
}
