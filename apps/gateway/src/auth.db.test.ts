/*
 * The sign-in routes against a real Postgres: request a code, verify it,
 * read the session, sign out, and claim anonymous builds on the way. Codes
 * are captured from a recording email adapter; nothing leaves localhost.
 */
import { buildMessages, builds, createDb, type DbConfig, emailCodes, llmCalls, sessions, tenantMembers, users } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { loadParts, readValidatedParts } from "@albusforge/registry/db-load";
import { REGISTRY_ROOT } from "@albusforge/registry/load";
import { ApiError, BuildList, CreatedBuild, Me, MessageList, PostMessageResponse } from "@albusforge/schema";
import type { AddressInfo } from "node:net";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import type { AuthOptions } from "./auth-routes";
import type { ChatOptions } from "./build-routes";
import { CODE_MAX_ATTEMPTS, createAuthStore, hashCode, normalizeEmail, PERSONAL_TENANT_NAME } from "./auth-store";
import { createChatStore } from "./chat-store";
import type { EmailSender, SignInCodeEmail } from "./email";
import { createTurnScheduler } from "./intake";
import { createLogger } from "./log";
import { hashAnonToken } from "./owner";
import { createPartsStore } from "./parts";
import { RateLimiter } from "./rate-limit";
import { hashSessionToken, newSessionToken } from "./session-cookie";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;

const lines: Record<string, unknown>[] = [];
const log = createLogger({ write: (line) => void lines.push(JSON.parse(line) as Record<string, unknown>) });

const sent: SignInCodeEmail[] = [];
let emailFails = false;
const email: EmailSender = {
  async sendSignInCode(message) {
    if (emailFails) throw new Error("provider down");
    sent.push(message);
  },
};

const apps: FastifyInstance[] = [];

function makeApp(overrides: Partial<AuthOptions> = {}, chat: Partial<ChatOptions> = {}): FastifyInstance {
  const app = buildApp({
    parts: createPartsStore(handle.db),
    ping: async () => void (await handle.pool.query("SELECT 1")),
    log,
    chat: { store: createChatStore(handle.db), turns: createTurnScheduler({ intake: null, log }), includeDrafts: false, ...chat },
    auth: { store: createAuthStore(handle.db, { newSessionToken }), email, ...overrides },
  });
  apps.push(app);
  return app;
}

/** Reads an event stream until the server closes it or `timeoutMs` passes; runs `then` once `after` events have arrived. */
async function readUntilClosed(url: string, cookie: string, then?: { afterEvents: number; run: () => Promise<void> }, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text = "";
  let ran = false;
  try {
    const response = await fetch(url, { headers: { cookie }, signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { closed: true, text };
      text += decoder.decode(value, { stream: true });
      if (then && !ran && (text.match(/^event: /gm)?.length ?? 0) >= then.afterEvents) {
        ran = true;
        await then.run();
      }
    }
  } catch (error) {
    if (controller.signal.aborted) return { closed: false, text };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();
  const migrate: DbConfig = { host: container.getHost(), port: container.getPort(), database: "albus", user: "albus_migrate", password: "migrate-secret", ssl: "disable" };
  await runMigrations(migrate, { appRole: { name: "albus_app", password: "app-secret" } });
  handle = createDb({ ...migrate, user: "albus_app", password: "app-secret" }, { max: 10 });
  await loadParts(handle.db, readValidatedParts(REGISTRY_ROOT));
});

afterAll(async () => {
  for (const app of apps) await app.close();
  await handle?.pool.end();
  await container?.stop();
});

beforeEach(() => {
  sent.length = 0;
  lines.length = 0;
  emailFails = false;
});

let emailCounter = 0;
const freshEmail = () => `ann+${++emailCounter}@example.com`;

const expectError = (response: { statusCode: number; json: () => unknown }, status: number, code: string) => {
  expect(response.statusCode).toBe(status);
  expect(ApiError.parse(response.json()).error.code).toBe(code);
};

const setCookies = (response: { headers: Record<string, unknown> }): string[] => {
  const value = response.headers["set-cookie"];
  return value === undefined ? [] : Array.isArray(value) ? value.map(String) : [String(value)];
};

const SESSION_LINE = /^__Host-albus_session=([A-Za-z0-9_-]{43}); Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/;
const SESSION_CLEARED = "__Host-albus_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0";
const ANON_CLEARED = "__Host-albus_anon=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0";

async function requestCode(app: FastifyInstance, address: string, headers: Record<string, string> = {}) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/code", payload: { email: address }, headers });
  return response;
}

/** Requests a code and returns the one the adapter captured. */
async function codeFor(app: FastifyInstance, address: string): Promise<string> {
  const response = await requestCode(app, address);
  expect(response.statusCode).toBe(204);
  const message = sent.at(-1);
  if (!message) throw new Error("no code was sent");
  return message.code;
}

async function verify(app: FastifyInstance, address: string, code: string, cookie?: string) {
  return app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email: address, code }, headers: cookie ? { cookie } : {} });
}

/** Signs a fresh or existing address in and returns the session cookie. */
async function signIn(app: FastifyInstance, address: string, cookie?: string) {
  const response = await verify(app, address, await codeFor(app, address), cookie);
  expect(response.statusCode).toBe(200);
  const token = SESSION_LINE.exec(setCookies(response)[0] ?? "")?.[1];
  if (!token) throw new Error(`no session cookie in ${setCookies(response).join(" | ")}`);
  return { me: Me.parse(response.json()), token, cookie: `__Host-albus_session=${token}`, response };
}

const me = (app: FastifyInstance, cookie?: string) => app.inject({ method: "GET", url: "/v1/me", headers: cookie ? { cookie } : {} });

describe("POST /v1/auth/code", () => {
  it("stores a hashed six-digit code valid for ten minutes and emails it, normalizing the address", async () => {
    const app = makeApp();
    const before = Date.now();
    const response = await requestCode(app, "Ann.Lee@Example.COM");
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ to: "ann.lee@example.com", code: expect.stringMatching(/^\d{6}$/), validForMinutes: 10 });

    const rows = await handle.db.select().from(emailCodes).where(eq(emailCodes.email, "ann.lee@example.com"));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.codeHash).toBe(hashCode(row.id, sent[0]!.code));
    expect(row.codeHash).not.toContain(sent[0]!.code);
    expect(row.attempts).toBe(0);
    expect(row.consumedAt).toBeNull();
    expect(row.expiresAt.getTime() - before).toBeGreaterThan(9.5 * 60_000);
    expect(row.expiresAt.getTime() - before).toBeLessThan(10.5 * 60_000);
  });

  it("invalidates the previous code when a new one is requested", async () => {
    const app = makeApp();
    const address = freshEmail();
    const first = await codeFor(app, address);
    const second = await codeFor(app, address);
    expectError(await verify(app, address, first), 400, "INVALID_CODE");
    expect((await verify(app, address, second)).statusCode).toBe(200);
  });

  it("serializes concurrent requests for one email, so exactly one code stays live", async () => {
    const store = createAuthStore(handle.db, { newSessionToken });
    const address = freshEmail();
    const issued = await Promise.all(Array.from({ length: 6 }, () => store.issueCode(address)));
    const rows = await handle.db.select().from(emailCodes).where(eq(emailCodes.email, normalizeEmail(address)));
    expect(rows).toHaveLength(6);
    const live = rows.filter((row) => row.consumedAt === null);
    expect(live).toHaveLength(1);
    // Superseded codes are rejected (and count as attempts); the survivor verifies exactly once.
    const attempt = (code: string) => store.verifyCode({ email: address, code, anonOwnerHash: undefined, currentSessionToken: undefined, sessionMaxAgeS: 60 });
    const codes = issued.map((i) => i.code);
    const survivor = codes.find((c) => hashCode(live[0]!.id, c) === live[0]!.codeHash)!;
    const superseded = codes.filter((c) => c !== survivor).slice(0, 2); // fewer than the attempt cap
    for (const code of superseded) expect((await attempt(code)).kind).toBe("rejected");
    expect((await attempt(survivor)).kind).toBe("verified");
    expect((await attempt(survivor)).kind).toBe("rejected");
  });

  it("rejects a malformed body and never logs or stores anything for it", async () => {
    const app = makeApp();
    expectError(await app.inject({ method: "POST", url: "/v1/auth/code", payload: { email: "not-an-email" } }), 400, "BAD_REQUEST");
    expectError(await app.inject({ method: "POST", url: "/v1/auth/code", payload: {} }), 400, "BAD_REQUEST");
    expect(sent).toHaveLength(0);
  });

  it("answers 503 UNAVAILABLE when the email cannot be sent, logging without the address", async () => {
    const app = makeApp();
    emailFails = true;
    const address = freshEmail();
    expectError(await requestCode(app, address), 503, "UNAVAILABLE");
    const failure = lines.find((l) => l.message === "sign-in code email failed");
    expect(failure).toBeDefined();
    expect(JSON.stringify(failure)).not.toContain(address);
  });

  it("rate-limits per email and per client IP with Retry-After", async () => {
    const app = makeApp({ rateLimits: { codesPerEmail: new RateLimiter(2, 60_000), codesPerIp: new RateLimiter(3, 60_000) } });
    const address = freshEmail();
    expect((await requestCode(app, address)).statusCode).toBe(204);
    expect((await requestCode(app, address)).statusCode).toBe(204);
    const limited = await requestCode(app, address);
    expectError(limited, 429, "RATE_LIMITED");
    expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
    // The IP window counted that refused request too (it is taken first), so the fourth is refused by IP.
    expectError(await requestCode(app, freshEmail()), 429, "RATE_LIMITED");
    // Another client IP, as the load balancer reports it, is unaffected.
    expect((await requestCode(app, freshEmail(), { "x-forwarded-for": "203.0.113.7, 35.1.1.1" })).statusCode).toBe(204);
  });

  it("keys the IP window on X-Albus-Client-IP only when the internal auth token verifies", async () => {
    const verifier = { verify: async (token: string) => token === "good" };
    const app = makeApp({ internalAuth: verifier, rateLimits: { codesPerIp: new RateLimiter(1, 60_000) } });
    const trusted = (ip: string, token = "good") => ({ "x-albus-internal-auth": `Bearer ${token}`, "x-albus-client-ip": ip });
    expect((await requestCode(app, freshEmail(), trusted("198.51.100.1"))).statusCode).toBe(204);
    expectError(await requestCode(app, freshEmail(), trusted("198.51.100.1")), 429, "RATE_LIMITED");
    expect((await requestCode(app, freshEmail(), trusted("198.51.100.2"))).statusCode).toBe(204);
    // A bad token: the forwarded IP is ignored and the request lands in the socket's bucket.
    expect((await requestCode(app, freshEmail(), trusted("198.51.100.3", "bad"))).statusCode).toBe(204);
    expectError(await requestCode(app, freshEmail(), trusted("198.51.100.4", "bad")), 429, "RATE_LIMITED");
  });
});

describe("POST /v1/auth/verify", () => {
  it("creates the user, a personal tenant with admin role, and a session, and sets the cookies", async () => {
    const app = makeApp();
    const address = freshEmail();
    const { me: signedIn, token, response } = await signIn(app, address);

    expect(signedIn.user.email).toBe(address);
    expect(signedIn.user.display_name).toBeNull();
    expect(signedIn.tenant).toEqual({ id: expect.any(String), name: PERSONAL_TENANT_NAME, slug: null, role: "admin" });
    expect(signedIn.tenants).toEqual([signedIn.tenant]);

    const cookies = setCookies(response);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(SESSION_LINE);
    expect(cookies[1]).toBe(ANON_CLEARED);
    for (const line of cookies) expect(line).not.toMatch(/Domain/i);

    const [session] = await handle.db.select().from(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
    expect(session).toMatchObject({ userId: signedIn.user.id, activeTenantId: signedIn.tenant.id, revokedAt: null, parentSessionId: null });
    expect(session!.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60_000);
    const [membership] = await handle.db.select().from(tenantMembers).where(eq(tenantMembers.userId, signedIn.user.id));
    expect(membership).toMatchObject({ tenantId: signedIn.tenant.id, role: "admin" });

    expect(lines.find((l) => l.message === "signed in")).toMatchObject({ userId: signedIn.user.id, tenantId: signedIn.tenant.id, claimedBuilds: 0 });
    expect(JSON.stringify(lines)).not.toContain(address);
  });

  it("signs an existing user in again without a second user or tenant, case-insensitively", async () => {
    const app = makeApp();
    const address = freshEmail();
    const first = await signIn(app, address);
    const again = await signIn(app, address.toUpperCase());
    expect(again.me.user.id).toBe(first.me.user.id);
    expect(again.me.tenant.id).toBe(first.me.tenant.id);
    expect(again.token).not.toBe(first.token);
    expect(await handle.db.select().from(users).where(eq(users.id, first.me.user.id))).toHaveLength(1);
    expect(await handle.db.select().from(tenantMembers).where(eq(tenantMembers.userId, first.me.user.id))).toHaveLength(1);
    // Both sessions are live.
    expect((await me(app, first.cookie)).statusCode).toBe(200);
    expect((await me(app, again.cookie)).statusCode).toBe(200);
  });

  it("claims the anonymous cookie's builds and their spend into the tenant, in the same request", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "A soil moisture logger" } });
    expect(created.statusCode).toBe(201);
    const build = CreatedBuild.parse(created.json());
    const anonCookie = setCookies(created)[0]!.split(";")[0]!;
    const anonToken = anonCookie.split("=")[1]!;
    const hash = hashAnonToken(anonToken);
    await handle.db.insert(llmCalls).values({ buildId: build.id, anonOwnerHash: hash, stage: "intake", model: "test", costUsd: "0.001" });
    // Someone else's build stays where it is.
    const other = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Not mine" } });
    const otherId = CreatedBuild.parse(other.json()).id;

    const address = freshEmail();
    const { me: signedIn } = await signIn(app, address, anonCookie);

    const [claimed] = await handle.db.select().from(builds).where(eq(builds.id, build.id));
    expect(claimed).toMatchObject({ tenantId: signedIn.tenant.id, anonOwnerHash: null });
    const [call] = await handle.db.select().from(llmCalls).where(eq(llmCalls.buildId, build.id));
    expect(call).toMatchObject({ tenantId: signedIn.tenant.id, anonOwnerHash: null });
    const [untouched] = await handle.db.select().from(builds).where(eq(builds.id, otherId));
    expect(untouched!.tenantId).toBeNull();
    expect(lines.find((l) => l.message === "signed in")).toMatchObject({ claimedBuilds: 1, claimedLlmCalls: 1 });

    // The anonymous cookie alone no longer reads the claimed build: it belongs to the tenant now.
    expect((await app.inject({ method: "GET", url: `/v1/builds/${build.id}`, headers: { cookie: anonCookie } })).statusCode).toBe(404);
  });

  it("rejects a wrong code, kills it after five misses, and never leaks which failed", async () => {
    const app = makeApp();
    const address = freshEmail();
    const code = await codeFor(app, address);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let attempt = 1; attempt < CODE_MAX_ATTEMPTS; attempt++) {
      const response = await verify(app, address, wrong);
      expectError(response, 400, "INVALID_CODE");
      expect(setCookies(response)).toHaveLength(0);
      const [row] = await handle.db.select().from(emailCodes).where(eq(emailCodes.email, address));
      expect(row).toMatchObject({ attempts: attempt, consumedAt: null });
    }
    expectError(await verify(app, address, wrong), 400, "INVALID_CODE");
    const [dead] = await handle.db.select().from(emailCodes).where(eq(emailCodes.email, address));
    expect(dead!.consumedAt).not.toBeNull();
    // The right code is dead too.
    expectError(await verify(app, address, code), 400, "INVALID_CODE");
    // And nothing was created for the address.
    expect(await handle.db.select().from(users).where(eq(users.email, address))).toHaveLength(0);
  });

  it("rejects a code that was never requested, one already used, one for another email, and an expired one", async () => {
    const app = makeApp();
    expectError(await verify(app, freshEmail(), "123456"), 400, "INVALID_CODE");

    const address = freshEmail();
    const code = await codeFor(app, address);
    expectError(await verify(app, freshEmail(), code), 400, "INVALID_CODE");
    expect((await verify(app, address, code)).statusCode).toBe(200);
    expectError(await verify(app, address, code), 400, "INVALID_CODE");

    const expiring = freshEmail();
    const expiringCode = await codeFor(app, expiring);
    await handle.db.update(emailCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(emailCodes.email, expiring));
    expectError(await verify(app, expiring, expiringCode), 400, "INVALID_CODE");
  });

  it("validates the body", async () => {
    const app = makeApp();
    expectError(await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email: "ann@example.com", code: "12345" } }), 400, "BAD_REQUEST");
    expectError(await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email: "ann@example.com", code: "12345a" } }), 400, "BAD_REQUEST");
    expectError(await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { code: "123456" } }), 400, "BAD_REQUEST");
  });

  it("rate-limits attempts per client IP", async () => {
    const app = makeApp({ rateLimits: { verifiesPerIp: new RateLimiter(2, 60_000) } });
    const address = freshEmail();
    const code = await codeFor(app, address);
    expectError(await verify(app, address, "000000"), 400, "INVALID_CODE");
    expectError(await verify(app, address, "000001"), 400, "INVALID_CODE");
    expectError(await verify(app, address, code), 429, "RATE_LIMITED");
  });
});

describe("build routes under a session", () => {
  const cookies = (...parts: string[]) => parts.join("; ");

  it("lists the tenant's builds, claimed ones included, newest first, and filters by status", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Claimed at sign-in" } });
    const claimedId = CreatedBuild.parse(created.json()).id;
    const anonCookie = setCookies(created)[0]!.split(";")[0]!;
    const { me: signedIn, cookie } = await signIn(app, freshEmail(), anonCookie);

    // A build made while signed in belongs to the tenant directly, and no anonymous cookie is issued.
    const own = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Made while signed in" }, headers: { cookie } });
    expect(own.statusCode).toBe(201);
    expect(own.headers["set-cookie"]).toBeUndefined();
    const ownBody = CreatedBuild.parse(own.json());
    expect(ownBody.build_id).toBe(ownBody.id);
    const [ownRow] = await handle.db.select().from(builds).where(eq(builds.id, ownBody.id));
    expect(ownRow).toMatchObject({ tenantId: signedIn.tenant.id, anonOwnerHash: null });

    const list = await app.inject({ method: "GET", url: "/v1/builds", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const { builds: listed } = BuildList.parse(list.json());
    expect(listed.map((b) => b.id)).toEqual([ownBody.id, claimedId]);
    expect(listed[1]).toMatchObject({ name: "Claimed at sign-in", display_status: "designing", device_count: 0 });

    expect(BuildList.parse((await app.inject({ method: "GET", url: "/v1/builds?status=designing", headers: { cookie } })).json()).builds).toHaveLength(2);
    expect(BuildList.parse((await app.inject({ method: "GET", url: "/v1/builds?status=live", headers: { cookie } })).json()).builds).toHaveLength(0);
    expectError(await app.inject({ method: "GET", url: "/v1/builds?status=nope", headers: { cookie } }), 400, "BAD_REQUEST");

    // Another user's list is empty; no session is a 401.
    const other = await signIn(app, freshEmail());
    expect(BuildList.parse((await app.inject({ method: "GET", url: "/v1/builds", headers: { cookie: other.cookie } })).json()).builds).toEqual([]);
    expectError(await app.inject({ method: "GET", url: "/v1/builds" }), 401, "UNAUTHENTICATED");
    expectError(await app.inject({ method: "GET", url: "/v1/builds", headers: { cookie: anonCookie } }), 401, "UNAUTHENTICATED");
  });

  it("reads, continues and streams a claimed build by session, with or without the stale anonymous cookie", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Keep talking after sign-in" } });
    const buildId = CreatedBuild.parse(created.json()).id;
    const anonCookie = setCookies(created)[0]!.split(";")[0]!;
    const { cookie } = await signIn(app, freshEmail(), anonCookie);
    const other = await signIn(app, freshEmail());

    for (const header of [cookie, cookies(anonCookie, cookie)]) {
      expect((await app.inject({ method: "GET", url: `/v1/builds/${buildId}`, headers: { cookie: header } })).statusCode).toBe(200);
      const messages = await app.inject({ method: "GET", url: `/v1/builds/${buildId}/messages`, headers: { cookie: header } });
      expect(messages.statusCode).toBe(200);
      expect(MessageList.parse(messages.json()).messages.map((m) => m.text)).toContain("Keep talking after sign-in");
    }

    // The previous turn must be answered before a new message is accepted.
    await handle.db.insert(buildMessages).values({ buildId, role: "assistant", text: "What should it measure?" });
    const posted = await app.inject({
      method: "POST",
      url: `/v1/builds/${buildId}/messages`,
      payload: { text: "Soil moisture", client_message_id: randomUUID() },
      headers: { cookie },
    });
    expect(posted.statusCode).toBe(202);
    expect(PostMessageResponse.parse(posted.json()).message.text).toBe("Soil moisture");

    // Someone else's session, or no credential at all, is a 404.
    expectError(await app.inject({ method: "GET", url: `/v1/builds/${buildId}`, headers: { cookie: other.cookie } }), 404, "NOT_FOUND");
    expectError(await app.inject({ method: "GET", url: `/v1/builds/${buildId}/messages`, headers: { cookie: other.cookie } }), 404, "NOT_FOUND");
    expectError(await app.inject({ method: "GET", url: `/v1/builds/${buildId}` }), 404, "NOT_FOUND");
    expectError(await app.inject({ method: "GET", url: `/v1/builds/${buildId}/events`, headers: { cookie: other.cookie } }), 404, "NOT_FOUND");
  });
});

describe("a session that loses access", () => {
  it("is signed out of the tenant's builds the moment its membership is removed", async () => {
    const app = makeApp();
    const { me: signedIn, cookie } = await signIn(app, freshEmail());
    const created = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Team build" }, headers: { cookie } });
    const buildId = CreatedBuild.parse(created.json()).id;
    expect((await app.inject({ method: "GET", url: "/v1/builds", headers: { cookie } })).statusCode).toBe(200);

    // Another admin keeps the tenant alive; this user is removed.
    const [other] = await handle.db.insert(users).values({ email: freshEmail() }).returning({ id: users.id });
    await handle.db.insert(tenantMembers).values({ tenantId: signedIn.tenant.id, userId: other!.id, role: "admin" });
    await handle.db.delete(tenantMembers).where(eq(tenantMembers.userId, signedIn.user.id));

    expectError(await me(app, cookie), 401, "UNAUTHENTICATED");
    expectError(await app.inject({ method: "GET", url: "/v1/builds", headers: { cookie } }), 401, "UNAUTHENTICATED");
    expectError(await app.inject({ method: "GET", url: `/v1/builds/${buildId}`, headers: { cookie } }), 404, "NOT_FOUND");
    expectError(await app.inject({ method: "GET", url: `/v1/builds/${buildId}/messages`, headers: { cookie } }), 404, "NOT_FOUND");
    expectError(
      await app.inject({ method: "POST", url: `/v1/builds/${buildId}/messages`, payload: { text: "still here?", client_message_id: randomUUID() }, headers: { cookie } }),
      404,
      "NOT_FOUND",
    );
  });

  it.each(["signout", "expiry", "membership"] as const)("keeps an admitted poll snapshot when %s precedes the message query", async (loss) => {
    const app = makeApp({}, { sse: { pollMs: 20, maxMs: 10_000 } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const signedIn = await signIn(app, freshEmail());
    const buildId = CreatedBuild.parse((await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Before access loss" }, headers: { cookie: signedIn.cookie } })).json()).id;
    const blocker = await handle.pool.connect();
    let reading: ReturnType<typeof readUntilClosed> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      // Initial authorization/owned-build admission does not query specs. The
      // poll's state query does: hold it AFTER auth fixed the RR snapshot but
      // BEFORE messages are read, without a production hook or guessed sleep.
      await blocker.query("LOCK TABLE builds.specs IN ACCESS EXCLUSIVE MODE");
      reading = readUntilClosed(`${base}/v1/builds/${buildId}/events`, signedIn.cookie);
      await expect.poll(async () => {
        const waiting = await handle.pool.query("SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid)) AND query LIKE '%specs%'", [pid]);
        return waiting.rowCount;
      }, { timeout: 5000 }).toBe(1);
      if (loss === "signout") {
        expect((await app.inject({ method: "POST", url: "/v1/auth/signout", headers: { cookie: signedIn.cookie } })).statusCode).toBe(204);
      } else if (loss === "expiry") {
        await handle.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, hashSessionToken(signedIn.token)));
      } else {
        await handle.db.delete(tenantMembers).where(eq(tenantMembers.userId, signedIn.me.user.id));
      }
      await handle.db.insert(buildMessages).values({ buildId, role: "assistant", text: "Private message after access loss" });
      await blocker.query("COMMIT");
      const result = await reading;
      expect(result.closed).toBe(true);
      expect(result.text).toContain("Before access loss"); // Already admitted data may finish.
      expect(result.text).not.toContain("Private message after access loss");
      // A poll never keeps its transaction open for heartbeat/socket lifetime.
      expect((await handle.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()")).rowCount).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await reading;
    }
  });

  it("loses an open event stream within a poll of signing out", async () => {
    const app = makeApp({}, { sse: { pollMs: 50, heartbeatMs: 200, maxMs: 10_000, lookbackMs: 1000, drainTimeoutMs: 1000, maxBufferedBytes: 1_000_000 } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const { cookie } = await signIn(app, freshEmail());
    const created = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Streaming build" }, headers: { cookie } });
    const buildId = CreatedBuild.parse(created.json()).id;

    const result = await readUntilClosed(`${base}/v1/builds/${buildId}/events`, cookie, {
      afterEvents: 1, // the first build.updated: the stream is live
      run: async () => {
        expect((await app.inject({ method: "POST", url: "/v1/auth/signout", headers: { cookie } })).statusCode).toBe(204);
        // Written after sign-out: must never reach the stream.
        await handle.db.insert(buildMessages).values({ buildId, role: "assistant", text: "private reply after sign-out" });
      },
    });
    expect(result.closed).toBe(true);
    expect(result.text).not.toContain("private reply after sign-out");
  });

  it("loses an open event stream when its session expires or its membership is removed", async () => {
    const app = makeApp({}, { sse: { pollMs: 50, heartbeatMs: 200, maxMs: 10_000, lookbackMs: 1000, drainTimeoutMs: 1000, maxBufferedBytes: 1_000_000 } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

    const expiring = await signIn(app, freshEmail());
    const first = CreatedBuild.parse((await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Expiring" }, headers: { cookie: expiring.cookie } })).json()).id;
    const expired = await readUntilClosed(`${base}/v1/builds/${first}/events`, expiring.cookie, {
      afterEvents: 1,
      run: async () => void (await handle.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, hashSessionToken(expiring.token)))),
    });
    expect(expired.closed).toBe(true);

    const removed = await signIn(app, freshEmail());
    const second = CreatedBuild.parse((await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Removed" }, headers: { cookie: removed.cookie } })).json()).id;
    const dropped = await readUntilClosed(`${base}/v1/builds/${second}/events`, removed.cookie, {
      afterEvents: 1,
      run: async () => void (await handle.db.delete(tenantMembers).where(eq(tenantMembers.userId, removed.me.user.id))),
    });
    expect(dropped.closed).toBe(true);
  });
});

describe("GET /v1/me", () => {
  it("returns the session's Me, and 401 UNAUTHENTICATED without a live session", async () => {
    const app = makeApp();
    const { me: signedIn, cookie } = await signIn(app, freshEmail());
    const response = await me(app, cookie);
    expect(response.statusCode).toBe(200);
    expect(Me.parse(response.json())).toEqual(signedIn);
    expect(response.headers["set-cookie"]).toBeUndefined();

    expectError(await me(app), 401, "UNAUTHENTICATED");
    expectError(await me(app, "__Host-albus_session=forged"), 401, "UNAUTHENTICATED");
    expectError(await me(app, `__Host-albus_session=${newSessionToken()}`), 401, "UNAUTHENTICATED");
  });

  it("treats an expired session as signed out", async () => {
    const app = makeApp();
    const { token, cookie } = await signIn(app, freshEmail());
    await handle.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, hashSessionToken(token)));
    expectError(await me(app, cookie), 401, "UNAUTHENTICATED");
  });
});

describe("POST /v1/auth/signout", () => {
  it("revokes the session and clears the cookie; the cookie is cleared even without a session", async () => {
    const app = makeApp();
    const { token, cookie } = await signIn(app, freshEmail());
    const response = await app.inject({ method: "POST", url: "/v1/auth/signout", headers: { cookie } });
    expect(response.statusCode).toBe(204);
    expect(setCookies(response)).toEqual([SESSION_CLEARED]);
    const [session] = await handle.db.select().from(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
    expect(session!.revokedAt).not.toBeNull();
    expectError(await me(app, cookie), 401, "UNAUTHENTICATED");
    expect(lines.find((l) => l.message === "signed out")).toMatchObject({ revokedSessions: 1 });

    const again = await app.inject({ method: "POST", url: "/v1/auth/signout", headers: { cookie } });
    expect(again.statusCode).toBe(204);
    expect(setCookies(again)).toEqual([SESSION_CLEARED]);
    const anonymous = await app.inject({ method: "POST", url: "/v1/auth/signout" });
    expect(anonymous.statusCode).toBe(204);
    expect(setCookies(anonymous)).toEqual([SESSION_CLEARED]);
  });

  it("revokes the whole session family: parent, siblings and children", async () => {
    const app = makeApp();
    const root = await signIn(app, freshEmail());
    const [rootRow] = await handle.db.select().from(sessions).where(eq(sessions.tokenHash, hashSessionToken(root.token)));
    const child = newSessionToken();
    const grandchild = newSessionToken();
    const unrelated = await signIn(app, freshEmail());
    const [childRow] = await handle.db
      .insert(sessions)
      .values({ tokenHash: hashSessionToken(child), userId: rootRow!.userId, activeTenantId: rootRow!.activeTenantId, parentSessionId: rootRow!.id, expiresAt: rootRow!.expiresAt })
      .returning({ id: sessions.id });
    await handle.db
      .insert(sessions)
      .values({ tokenHash: hashSessionToken(grandchild), userId: rootRow!.userId, activeTenantId: rootRow!.activeTenantId, parentSessionId: childRow!.id, expiresAt: rootRow!.expiresAt });

    // Signing out on the child revokes root, child and grandchild.
    const response = await app.inject({ method: "POST", url: "/v1/auth/signout", headers: { cookie: `__Host-albus_session=${child}` } });
    expect(response.statusCode).toBe(204);
    expect(lines.find((l) => l.message === "signed out")).toMatchObject({ revokedSessions: 3 });
    for (const token of [root.token, child, grandchild]) expectError(await me(app, `__Host-albus_session=${token}`), 401, "UNAUTHENTICATED");
    expect((await me(app, unrelated.cookie)).statusCode).toBe(200);
  });
});
