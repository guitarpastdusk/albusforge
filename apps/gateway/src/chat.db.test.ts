/*
 * The anonymous chat routes against a real Postgres, with a stub intake
 * server standing in for POST /v1/turns. No network beyond localhost.
 */
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildMessages, builds, createDb, type DbConfig, specs } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { loadParts, readValidatedParts } from "@albusforge/registry/db-load";
import { REGISTRY_ROOT } from "@albusforge/registry/load";
import { ApiError, BuildDetail, BuildUpdatedEvent, CreatedBuild, MessageCreatedEvent, MessageList, PostMessageResponse } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import type { ChatOptions } from "./build-routes";
import { createChatStore } from "./chat-store";
import { createTurnScheduler, httpIntakeClient, type TurnScheduler } from "./intake";
import { createLogger } from "./log";
import { createPartsStore } from "./parts";
import { RateLimiter } from "./rate-limit";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
let intake: http.Server;
let intakeUrl: string;
const intakeCalls: unknown[] = [];
let intakeStatus = 200;

const lines: Record<string, unknown>[] = [];
const rawLines: string[] = [];
const log = createLogger({
  write: (line) => {
    rawLines.push(line);
    lines.push(JSON.parse(line) as Record<string, unknown>);
  },
});

const apps: FastifyInstance[] = [];

function makeApp(overrides: Partial<ChatOptions> = {}): { app: FastifyInstance; turns: TurnScheduler } {
  const turns = createTurnScheduler({
    intake: httpIntakeClient({ url: intakeUrl, authHeader: async () => undefined }),
    log,
    timeoutMs: 2000,
    retryDelayMs: 10,
  });
  const app = buildApp({
    parts: createPartsStore(handle.db),
    ping: async () => void (await handle.pool.query("SELECT 1")),
    log,
    chat: { store: createChatStore(handle.db), turns, includeDrafts: false, sse: { pollMs: 50, heartbeatMs: 200, maxMs: 10_000 }, ...overrides },
  });
  apps.push(app);
  return { app, turns };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();
  const migrate: DbConfig = {
    host: container.getHost(),
    port: container.getPort(),
    database: "albus",
    user: "albus_migrate",
    password: "migrate-secret",
    ssl: "disable",
  };
  await runMigrations(migrate, { appRole: { name: "albus_app", password: "app-secret" } });
  handle = createDb({ ...migrate, user: "albus_app", password: "app-secret" }, { max: 5 });
  await loadParts(handle.db, readValidatedParts(REGISTRY_ROOT));

  intake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      intakeCalls.push(JSON.parse(raw));
      res.writeHead(intakeStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(intakeStatus === 200 ? { noop: true } : { error: "boom" }));
    });
  });
  await new Promise<void>((resolve) => intake.listen(0, "127.0.0.1", resolve));
  intakeUrl = `http://127.0.0.1:${(intake.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const app of apps) await app.close();
  await new Promise<void>((resolve) => (intake ? intake.close(() => resolve()) : resolve()));
  await handle?.pool.end();
  await container?.stop();
});

beforeEach(() => {
  intakeCalls.length = 0;
  intakeStatus = 200;
  lines.length = 0;
  rawLines.length = 0;
});

const cookieFrom = (setCookie: unknown) => {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const token = /^__Host-albus_anon=([A-Za-z0-9_-]{43});/.exec(String(header))?.[1];
  if (!token) throw new Error(`no anon cookie in ${String(header)}`);
  return { token, cookie: `__Host-albus_anon=${token}` };
};

async function createBuild(app: FastifyInstance, askText = "A temperature sensor for my greenhouse", cookie?: string) {
  const response = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: askText }, headers: cookie ? { cookie } : {} });
  expect(response.statusCode).toBe(201);
  const body = CreatedBuild.parse(response.json());
  return { body, response, cookie: cookie ?? cookieFrom(response.headers["set-cookie"]).cookie };
}

/** Marks the build's last user message as answered, as intake would. */
const reply = (buildId: string, text = "What should it measure?") =>
  handle.db.insert(buildMessages).values({ buildId, role: "assistant", text }).returning({ id: buildMessages.id });

const expectError = (response: { statusCode: number; json: () => unknown }, status: number, code: string) => {
  expect(response.statusCode).toBe(status);
  expect(ApiError.parse(response.json()).error.code).toBe(code);
};

describe("POST /v1/builds", () => {
  it("issues the anonymous owner cookie, stores its hash, inserts the first message and starts a turn", async () => {
    const { app, turns } = makeApp();
    const response = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "  A soil moisture sensor  " } });
    expect(response.statusCode).toBe(201);
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toMatch(/^__Host-albus_anon=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    const { token } = cookieFrom(setCookie);

    const body = CreatedBuild.parse(response.json());
    expect(body).toMatchObject({
      build_id: body.id,
      status: "asking",
      name: "A soil moisture sensor",
      description: "A soil moisture sensor",
      display_status: "designing",
      device_count: 0,
      ready: null,
      spec: null,
      spec_version: null,
      candidate_parts: [],
    });

    const [row] = await handle.db.select().from(builds).where(eq(builds.id, body.id));
    expect(row?.anonOwnerHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row?.tenantId).toBeNull();

    await turns.idle();
    expect(intakeCalls).toEqual([{ build_id: body.id }]);
    expect(rawLines.join("")).not.toContain(token);
  });

  it("reuses a valid cookie and replaces a malformed one", async () => {
    const { app } = makeApp();
    const first = await createBuild(app);
    const again = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Second" }, headers: { cookie: first.cookie } });
    expect(again.statusCode).toBe(201);
    expect(again.headers["set-cookie"]).toBeUndefined();
    const [a, b] = await Promise.all(
      [first.body.id, CreatedBuild.parse(again.json()).id].map(async (id) => (await handle.db.select().from(builds).where(eq(builds.id, id)))[0]?.anonOwnerHash),
    );
    expect(a).toBe(b);

    const bad = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "Third" }, headers: { cookie: "__Host-albus_anon=forged" } });
    expect(bad.statusCode).toBe(201);
    expect(bad.headers["set-cookie"]).toBeDefined();
  });

  it("returns the same build for a replayed client_message_id", async () => {
    const { app } = makeApp();
    const clientMessageId = randomUUID();
    const first = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "A door sensor", client_message_id: clientMessageId } });
    expect(first.statusCode).toBe(201);
    const { cookie } = cookieFrom(first.headers["set-cookie"]);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/builds",
      payload: { ask_text: "A door sensor", client_message_id: clientMessageId },
      headers: { cookie },
    });
    expect(replay.statusCode).toBe(200);
    expect(CreatedBuild.parse(replay.json()).id).toBe(CreatedBuild.parse(first.json()).id);
  });

  it.each([{}, { ask_text: " " }, { ask_text: "x".repeat(2001) }, { ask_text: "ok", client_message_id: "not-a-uuid" }])("rejects %j", async (payload) => {
    const { app } = makeApp();
    const response = await app.inject({ method: "POST", url: "/v1/builds", payload });
    expectError(response, 400, "BAD_REQUEST");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("rate-limits new builds per anonymous owner", async () => {
    const { app } = makeApp({ rateLimits: { builds: new RateLimiter(2, 60_000) } });
    const { cookie } = await createBuild(app);
    await createBuild(app, "two", cookie);
    const limited = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "three" }, headers: { cookie } });
    expectError(limited, 429, "RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    // Another owner is unaffected.
    await createBuild(app, "someone else");
  });

  it("caps build creation without a cookie across the instance, warning once per window", async () => {
    const { app } = makeApp({ rateLimits: { anonOwners: new RateLimiter(2, 60 * 60_000) } });
    const { cookie } = await createBuild(app, "one");
    await createBuild(app, "two");
    for (let i = 0; i < 3; i++) {
      const limited = await app.inject({ method: "POST", url: "/v1/builds", payload: { ask_text: "more" } });
      expectError(limited, 429, "RATE_LIMITED");
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      expect(limited.headers["set-cookie"]).toBeUndefined();
    }
    expect(lines.filter((l) => l.message === "anonymous build cap reached on this instance")).toEqual([
      expect.objectContaining({ severity: "WARNING", limit: 2, windowMs: 3_600_000 }),
    ]);
    // A visitor who already holds a cookie isn't counted against the cap.
    await createBuild(app, "returning visitor", cookie);
  });
});

describe("ownership", () => {
  it("answers 404 to anyone but the owner, on every build route", async () => {
    const { app } = makeApp();
    const { body } = await createBuild(app);
    const stranger = (await createBuild(app, "mine")).cookie;
    const routes = [
      ["GET", `/v1/builds/${body.id}`],
      ["GET", `/v1/builds/${body.id}/messages`],
      ["POST", `/v1/builds/${body.id}/messages`],
      ["GET", `/v1/builds/${body.id}/events`],
    ] as const;
    for (const [method, url] of routes) {
      for (const headers of [{}, { cookie: stranger }, { cookie: "__Host-albus_anon=nope" }]) {
        const response = await app.inject({ method, url, headers, ...(method === "POST" ? { payload: { text: "hi", client_message_id: randomUUID() } } : {}) });
        expectError(response, 404, "NOT_FOUND");
      }
    }
  });

  it("answers 404 for a malformed or unknown id", async () => {
    const { app } = makeApp();
    const { cookie } = await createBuild(app);
    expectError(await app.inject({ method: "GET", url: "/v1/builds/not-a-uuid", headers: { cookie } }), 404, "NOT_FOUND");
    expectError(await app.inject({ method: "GET", url: `/v1/builds/${randomUUID()}`, headers: { cookie } }), 404, "NOT_FOUND");
  });

  it("keeps the list route a 501", async () => {
    const { app } = makeApp();
    expectError(await app.inject({ method: "GET", url: "/v1/builds" }), 501, "NOT_IMPLEMENTED");
  });
});

describe("messages", () => {
  it("lists the transcript oldest first", async () => {
    const { app } = makeApp();
    const { body, cookie } = await createBuild(app, "First ask");
    await reply(body.id, "Indoors or out?");
    const response = await app.inject({ method: "GET", url: `/v1/builds/${body.id}/messages`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(MessageList.parse(response.json()).messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "First ask"],
      ["assistant", "Indoors or out?"],
    ]);
  });

  it("stores a message once per client_message_id and starts one turn", async () => {
    const { app, turns } = makeApp();
    const { body, cookie } = await createBuild(app);
    await turns.idle();
    await reply(body.id);
    intakeCalls.length = 0;

    const clientMessageId = randomUUID();
    const post = () =>
      app.inject({ method: "POST", url: `/v1/builds/${body.id}/messages`, headers: { cookie }, payload: { text: "Indoors", client_message_id: clientMessageId } });
    const first = await post();
    expect(first.statusCode).toBe(202);
    const { message } = PostMessageResponse.parse(first.json());
    expect(message).toMatchObject({ role: "user", text: "Indoors", client_message_id: clientMessageId });

    const again = await post();
    expect(again.statusCode).toBe(200);
    expect(PostMessageResponse.parse(again.json()).message.id).toBe(message.id);

    await turns.idle();
    expect(intakeCalls).toEqual([{ build_id: body.id }]);
    const stored = await handle.db.select().from(buildMessages).where(eq(buildMessages.buildId, body.id));
    expect(stored.filter((m) => m.clientMessageId === clientMessageId)).toHaveLength(1);
  });

  it("requires a uuid client_message_id and bounded text", async () => {
    const { app } = makeApp();
    const { body, cookie } = await createBuild(app);
    for (const payload of [{ text: "hi" }, { text: "hi", client_message_id: "x" }, { text: "x".repeat(4001), client_message_id: randomUUID() }]) {
      expectError(await app.inject({ method: "POST", url: `/v1/builds/${body.id}/messages`, headers: { cookie }, payload }), 400, "BAD_REQUEST");
    }
  });

  it("answers 409 TURN_IN_PROGRESS while the last user message is recent and unanswered", async () => {
    const { app } = makeApp();
    const { body, cookie } = await createBuild(app);
    const send = () =>
      app.inject({ method: "POST", url: `/v1/builds/${body.id}/messages`, headers: { cookie }, payload: { text: "hello?", client_message_id: randomUUID() } });
    expectError(await send(), 409, "TURN_IN_PROGRESS");

    // Unanswered but older than 60 s: accepted, so a lost turn can be retried.
    await handle.pool.query(`UPDATE builds.build_messages SET created_at = now() - interval '61 seconds' WHERE build_id = $1`, [body.id]);
    expect((await send()).statusCode).toBe(202);
  });

  it("rate-limits messages per anonymous owner", async () => {
    const { app } = makeApp({ rateLimits: { messages: new RateLimiter(1, 60_000) } });
    const { body, cookie } = await createBuild(app);
    await reply(body.id);
    const send = () =>
      app.inject({ method: "POST", url: `/v1/builds/${body.id}/messages`, headers: { cookie }, payload: { text: "yes", client_message_id: randomUUID() } });
    expect((await send()).statusCode).toBe(202);
    await reply(body.id);
    expectError(await send(), 429, "RATE_LIMITED");
  });

  it("retries a 5xx once, then logs a WARNING, and keeps serving", async () => {
    const { app, turns } = makeApp();
    intakeStatus = 500;
    const { body, cookie } = await createBuild(app);
    await turns.idle();
    expect(intakeCalls).toEqual([{ build_id: body.id }, { build_id: body.id }]);
    expect(lines).toContainEqual(
      expect.objectContaining({ severity: "WARNING", message: "intake turn failed", buildId: body.id, attempt: 2, intakeStatus: 500 }),
    );
    expect((await app.inject({ method: "GET", url: `/v1/builds/${body.id}`, headers: { cookie } })).statusCode).toBe(200);
  });

  it("recovers a lost turn when the transcript is refetched, once per build per minute however many reads arrive", async () => {
    const { app, turns } = makeApp();
    const { body, cookie } = await createBuild(app);
    await turns.idle();
    intakeCalls.length = 0;

    // Unanswered but recent: a refetch starts nothing.
    await app.inject({ method: "GET", url: `/v1/builds/${body.id}/messages`, headers: { cookie } });
    await turns.idle();
    expect(intakeCalls).toEqual([]);

    await handle.pool.query(`UPDATE builds.build_messages SET created_at = now() - interval '61 seconds' WHERE build_id = $1`, [body.id]);
    const burst = () =>
      Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          app.inject({ method: "GET", url: i % 2 === 0 ? `/v1/builds/${body.id}/messages` : `/v1/builds/${body.id}`, headers: { cookie } }),
        ),
      );
    expect((await burst()).map((r) => r.statusCode)).toEqual(Array(8).fill(200));
    await turns.idle();
    expect(intakeCalls).toEqual([{ build_id: body.id }]);
    expect(lines.filter((l) => l.message === "recovering an unanswered turn")).toHaveLength(1);

    // Still unanswered (the stub only answers noop), but inside the minute: no second turn.
    await burst();
    await turns.idle();
    expect(intakeCalls).toHaveLength(1);
  });

  it("doesn't recover a build whose newest message is the assistant's", async () => {
    const { app, turns } = makeApp();
    const { body, cookie } = await createBuild(app);
    await turns.idle();
    await handle.pool.query(`UPDATE builds.build_messages SET created_at = now() - interval '2 minutes' WHERE build_id = $1`, [body.id]);
    await reply(body.id);
    intakeCalls.length = 0;
    await app.inject({ method: "GET", url: `/v1/builds/${body.id}`, headers: { cookie } });
    await turns.idle();
    expect(intakeCalls).toEqual([]);
  });
});

describe("GET /v1/builds/:id", () => {
  it("returns the latest spec and the capability-matched parts, active only unless drafts are included", async () => {
    const { app } = makeApp();
    const { app: withDrafts } = makeApp({ includeDrafts: true });
    const { body, cookie } = await createBuild(app);
    await handle.db.insert(specs).values([
      { buildId: body.id, version: 1, data: { capabilities: ["read.motion_bool"], settled: false }, confidence: 0.2 },
      { buildId: body.id, version: 2, data: { capabilities: ["read.temperature_c", "power.battery"], settled: false, sense: ["temperature"] }, confidence: 0.6 },
    ]);

    // Every committed part is a draft.
    const active = BuildDetail.parse((await app.inject({ method: "GET", url: `/v1/builds/${body.id}`, headers: { cookie } })).json());
    expect(active).toMatchObject({ spec_version: 2, spec: { capabilities: ["read.temperature_c", "power.battery"], sense: ["temperature"] }, candidate_parts: [] });

    const drafts = BuildDetail.parse((await withDrafts.inject({ method: "GET", url: `/v1/builds/${body.id}`, headers: { cookie } })).json());
    expect(drafts.candidate_parts?.map((p) => [p.id, p.matched_capabilities])).toEqual([
      ["E-001", ["power.battery"]],
      ["P-001", ["read.temperature_c"]],
      ["P-002", ["read.temperature_c"]],
    ]);
  });
});

type EventCheck = (events: SseEvent[], text: string) => boolean;

/**
 * Reads an event stream until `until` holds, or fails after `timeoutMs` (the
 * abort also interrupts a pending read). `then.run` executes once, as soon as
 * `then.when` holds, so a test can change the database at a known point in the
 * stream instead of after a guessed delay.
 */
async function readEvents(url: string, headers: Record<string, string>, until: EventCheck, then?: { when: EventCheck; run: () => Promise<void> }, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text = "";
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let ran = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const events = parseEvents(text);
      if (then && !ran && then.when(events, text)) {
        ran = true;
        await then.run();
      }
      if (until(events, text)) return { events, text };
    }
    throw new Error(`stream ended without the expected events:\n${text}`);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`timed out after ${timeoutMs} ms waiting for events:\n${text}`);
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

const messageTexts = (events: SseEvent[]) => events.filter((e) => e.event === "message.created").map((e) => MessageCreatedEvent.parse(e.data).message.text);
const buildUpdates = (events: SseEvent[]) => events.filter((e) => e.event === "build.updated").map((e) => BuildUpdatedEvent.parse(e.data));

interface SseEvent {
  id?: string;
  event?: string;
  data: unknown;
}

function parseEvents(text: string): SseEvent[] {
  return text
    .split("\n\n")
    .slice(0, -1)
    .map((block) => {
      const event: Partial<SseEvent> & { data?: unknown } = {};
      for (const line of block.split("\n")) {
        if (line.startsWith("id: ")) event.id = line.slice(4);
        else if (line.startsWith("event: ")) event.event = line.slice(7);
        else if (line.startsWith("data: ")) event.data = JSON.parse(line.slice(6));
      }
      return event as SseEvent;
    })
    .filter((event) => event.event !== undefined);
}

describe("GET /v1/builds/:id/events", () => {
  let base: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    app = makeApp().app;
    await app.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  it("starts with build.updated, replays the transcript, then streams later messages and status changes", async () => {
    const ask = "A temperature sensor for my greenhouse";
    const { body, cookie } = await createBuild(app, ask);
    const { events } = await readEvents(
      `${base}/v1/builds/${body.id}/events`,
      { cookie },
      (events) =>
        messageTexts(events).includes("Inserted after connect") && buildUpdates(events).some((u) => u.status === "specifying" && u.spec_version === 1),
      {
        // Only once the connect-time events are in, so the changes below can't fold into them.
        when: (events) => messageTexts(events).includes(ask),
        run: async () => {
          await reply(body.id, "Inserted after connect");
          await handle.db.transaction(async (tx) => {
            await tx.insert(specs).values({ buildId: body.id, version: 1, data: { capabilities: [] }, confidence: 0.1 });
            await tx.update(builds).set({ status: "specifying" }).where(eq(builds.id, body.id));
          });
        },
      },
    );

    // The contract: build.updated is the first event, then the transcript oldest first.
    expect(events[0]).toEqual({ event: "build.updated", data: { status: "asking", spec_version: null } });
    expect(events[1]).toMatchObject({ event: "message.created", data: { message: { role: "user", text: ask } } });
    expect(messageTexts(events)).toEqual([ask, "Inserted after connect"]);
    expect(buildUpdates(events)).toEqual([
      { status: "asking", spec_version: null },
      { status: "specifying", spec_version: 1 },
    ]);
    // Message events carry a cursor id; build.updated repeats the latest one.
    const ids = events.map((e) => e.id);
    expect(ids[1]).toMatch(/^\d+\.[0-9a-f-]{36}$/);
    expect(ids.slice(1).every((id) => id !== undefined)).toBe(true);
  });

  it("sends a heartbeat comment at the configured interval", async () => {
    // makeApp's heartbeat is 200 ms; production's is 15 s.
    const { body, cookie } = await createBuild(app);
    const { text } = await readEvents(`${base}/v1/builds/${body.id}/events`, { cookie }, (_events, text) => text.includes(": ping\n\n"), undefined, 3000);
    expect(text).toContain(": ping");
  });

  it("resumes after Last-Event-ID", async () => {
    const { body, cookie } = await createBuild(app, "Resume me");
    await reply(body.id, "second");
    const first = await readEvents(`${base}/v1/builds/${body.id}/events`, { cookie }, (events) => events.filter((e) => e.event === "message.created").length === 2);
    const firstMessage = first.events.find((e) => e.event === "message.created")!;
    expect(firstMessage.id).toMatch(/^\d+\.[0-9a-f-]{36}$/);

    await reply(body.id, "third");
    const resumed = await readEvents(
      `${base}/v1/builds/${body.id}/events`,
      { cookie, "last-event-id": firstMessage.id! },
      (events) => events.filter((e) => e.event === "message.created").length === 2,
    );
    expect(resumed.events[0]?.event).toBe("build.updated");
    expect(messageTexts(resumed.events)).toEqual(["second", "third"]);
  });

  it("ends the stream after maxMs", async () => {
    const short = makeApp({ sse: { pollMs: 50, heartbeatMs: 1000, maxMs: 300 } }).app;
    const { body, cookie } = await createBuild(short);
    await short.listen({ port: 0, host: "127.0.0.1" });
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${(short.server.address() as AddressInfo).port}/v1/builds/${body.id}/events`, { headers: { cookie } });
    await response.text();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
