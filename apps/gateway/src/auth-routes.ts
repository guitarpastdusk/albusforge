/*
 * Sign-in by email code (ADR 0008): request a code, verify it for a session
 * cookie, read the session, sign out. Verify also claims the caller's
 * anonymous builds (PORTAL.md §5) and clears the anonymous owner cookie.
 *
 * Every failure to verify is the same 400 INVALID_CODE, whether there was no
 * code, it expired, it was wrong, or it was tried too often: the portal shows
 * "That code didn't work" for any 4xx, and nothing tells a guesser which.
 */
import { Me, RequestCodeRequest, routes, VerifyCodeRequest, VerifyCodeResponse } from "@albusforge/schema";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type AuthStore, CODE_TTL_MS } from "./auth-store";
import type { EmailSender } from "./email";
import { HttpError, parse } from "./http";
import { clientIp, type InternalAuthVerifier, untrustingVerifier } from "./internal-auth";
import type { Log } from "./log";
import { anonTokenFromCookieHeader, hashAnonToken } from "./owner";
import { RateLimiter } from "./rate-limit";
import { anonOwnerClearCookie, SESSION_MAX_AGE_S, sessionClearCookie, sessionSetCookie, sessionTokenFromCookieHeader } from "./session-cookie";

export interface AuthOptions {
  store: AuthStore;
  email: EmailSender;
  /** Verifies X-Albus-Internal-Auth so X-Albus-Client-IP can be trusted. Default trusts nothing. */
  internalAuth?: InternalAuthVerifier;
  /** X-Forwarded-For entries that belong to our proxies (TRUSTED_PROXY_HOPS). Default 1, the load balancer. */
  trustedProxyHops?: number;
  /**
   * Code requests per email and per client IP, and verify attempts per client
   * IP, in sliding windows. Defaults: 5 codes per email and 20 per IP in 15
   * minutes; 30 verifies per IP in 15 minutes.
   */
  rateLimits?: { codesPerEmail?: RateLimiter; codesPerIp?: RateLimiter; verifiesPerIp?: RateLimiter };
  sessionMaxAgeS?: number;
}

const WINDOW_15_MIN_MS = 15 * 60_000;

function rateLimited(retryMs: number, what: string): HttpError {
  const retryAfterS = Math.max(1, Math.ceil(retryMs / 1000));
  return new HttpError(429, "RATE_LIMITED", `Too many ${what}; try again later`, { retry_after_s: retryAfterS }, { "retry-after": String(retryAfterS) });
}

const invalidCode = () => new HttpError(400, "INVALID_CODE", "That code is not valid for this email, has expired, or has been tried too many times");

export function registerAuthRoutes(app: FastifyInstance, { log, auth }: { log: Log; auth: AuthOptions }): void {
  const { store, email } = auth;
  const verifier = auth.internalAuth ?? untrustingVerifier;
  const trustedProxyHops = auth.trustedProxyHops ?? 1;
  const codesPerEmail = auth.rateLimits?.codesPerEmail ?? new RateLimiter(5, WINDOW_15_MIN_MS);
  const codesPerIp = auth.rateLimits?.codesPerIp ?? new RateLimiter(20, WINDOW_15_MIN_MS);
  const verifiesPerIp = auth.rateLimits?.verifiesPerIp ?? new RateLimiter(30, WINDOW_15_MIN_MS);
  const sessionMaxAgeS = auth.sessionMaxAgeS ?? SESSION_MAX_AGE_S;

  const ip = (request: FastifyRequest) => clientIp({ headers: request.headers, ip: request.ip }, { verifier, trustedProxyHops });
  const fields = (request: FastifyRequest, extra: Record<string, unknown> = {}) => ({ requestId: request.id, ...extra });

  app.post(routes.auth.requestCode.pattern, async (request, reply) => {
    const body = parse(RequestCodeRequest, request.body, "request body");
    const address = body.email.trim().toLowerCase();

    // The IP window first: it is the one a single caller can't widen by varying the email.
    const ipRetryMs = codesPerIp.take(await ip(request));
    if (ipRetryMs > 0) throw rateLimited(ipRetryMs, "sign-in code requests");
    const emailRetryMs = codesPerEmail.take(address);
    if (emailRetryMs > 0) throw rateLimited(emailRetryMs, "sign-in code requests for this email");

    const { code } = await store.issueCode(address);
    try {
      await email.sendSignInCode({ to: address, code, validForMinutes: CODE_TTL_MS / 60_000 });
    } catch (error) {
      // Neither the address nor the code is logged; the request id ties the line to the request.
      log("ERROR", "sign-in code email failed", { error, trace: request.trace, fields: fields(request) });
      throw new HttpError(503, "UNAVAILABLE", "Could not send the sign-in email; try again shortly");
    }
    return reply.code(204).send();
  });

  app.post(routes.auth.verify.pattern, async (request, reply) => {
    const body = parse(VerifyCodeRequest, request.body, "request body");

    const retryMs = verifiesPerIp.take(await ip(request));
    if (retryMs > 0) throw rateLimited(retryMs, "sign-in attempts");

    const anonToken = anonTokenFromCookieHeader(request.headers.cookie);
    const result = await store.verifyCode({
      email: body.email,
      code: body.code,
      anonOwnerHash: anonToken === undefined ? undefined : hashAnonToken(anonToken),
      currentSessionToken: sessionTokenFromCookieHeader(request.headers.cookie),
      sessionMaxAgeS,
    });
    if (result.kind === "rejected") throw invalidCode();

    log("INFO", "signed in", {
      trace: request.trace,
      fields: fields(request, { userId: result.me.user.id, tenantId: result.me.tenant.id, claimedBuilds: result.claimed.builds, claimedLlmCalls: result.claimed.llmCalls }),
    });
    // The anonymous cookie is cleared even when none arrived: the mock does the same, and a stale one is harmless either way.
    reply.header("set-cookie", [sessionSetCookie(result.sessionToken, sessionMaxAgeS), anonOwnerClearCookie()]);
    return reply.code(200).send(VerifyCodeResponse.parse(result.me));
  });

  app.get(routes.me.get.pattern, async (request) => {
    const token = sessionTokenFromCookieHeader(request.headers.cookie);
    const me = token === undefined ? null : await store.me(token);
    if (!me) throw new HttpError(401, "UNAUTHENTICATED", "Not signed in");
    return Me.parse(me);
  });

  app.post(routes.auth.signOut.pattern, async (request, reply) => {
    const token = sessionTokenFromCookieHeader(request.headers.cookie);
    const revoked = token === undefined ? 0 : await store.revokeSessionFamily(token);
    if (revoked > 0) log("INFO", "signed out", { trace: request.trace, fields: fields(request, { revokedSessions: revoked }) });
    // Cleared whether or not a live session was found: the browser's cookie is stale either way.
    reply.header("set-cookie", sessionClearCookie());
    return reply.code(204).send();
  });
}
