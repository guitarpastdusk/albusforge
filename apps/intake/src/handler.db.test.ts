/*
 * POST /v1/turns' handler against a real Postgres: migrate with @albusforge/db,
 * load the committed registry, then answer turns with replayed model responses.
 * Checks what's written, attribution, idempotency, concurrency and deadlines.
 */
import { buildMessages, builds, createDb, type DbConfig, llmCalls, specs, tenants } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { buildTokensUsed, createMeter, llmCallsInserter, type LlmResponse } from "@albusforge/llm";
import { fakeResponse, hangingResponse, replayProvider, type ReplayProvider } from "@albusforge/llm/testing";
import { loadParts, readValidatedParts } from "@albusforge/registry/db-load";
import { REGISTRY_ROOT } from "@albusforge/registry/load";
import { Spec } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { asc, eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTurnScheduler, IntakeError, type TurnResult } from "../../gateway/src/intake";
import { GOLDEN_ASKS, goldenTurn } from "../test/fixtures";
import { type CatalogueCache, createCatalogueCache, dbPartsSource } from "./catalogue";
import { isDatabaseUnavailable } from "./db-errors";
import { emptySpec } from "./decide";
import { buildApp } from "./app";
import { handleTurn, type HandlerDeps, turnsHandler } from "./handler";
import { createLogger } from "./log";
import { loadPrompts } from "./prompts";
import { FALLBACK_REPLY, offTopicReply, outOfScopeReply, TOKEN_CEILING_REPLY } from "./replies";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;
/** The app role's connection settings, for a test that needs a pool of its own. */
let appConfig: DbConfig;

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
  // As the service runs: the app role, a small pool, a statement timeout.
  appConfig = { ...migrate, user: "albus_app", password: "app-secret" };
  handle = createDb(appConfig, { max: 5, statementTimeoutMs: 10_000 });
  await loadParts(handle.db, readValidatedParts(REGISTRY_ROOT));
});

afterAll(async () => {
  await handle?.pool.end();
  await container?.stop();
});

interface Setup {
  deps: HandlerDeps;
  provider: ReplayProvider;
  lines: string[];
  /** This turn's catalogue cache, so a test can warm it before timing anything. */
  catalogue: CatalogueCache;
}

type Response = LlmResponse | ((request: never, signal?: AbortSignal) => Promise<LlmResponse>);

function setup(responses: Response[], overrides: { deadlineMs?: number; budgetMs?: number; tokenCeiling?: number } = {}): Setup {
  const deadlineMs = overrides.deadlineMs ?? 45_000;
  const provider = replayProvider(responses as Parameters<typeof replayProvider>[0]);
  const catalogue = createCatalogueCache({ source: dbPartsSource(), includeDrafts: true });
  const lines: string[] = [];
  const log = createLogger({ write: () => {} });
  const deps: HandlerDeps = {
    pool: handle.pool,
    log,
    deadlineMs,
    // Unset means the handler's default: the turn plus a fifteenth of it for
    // cleanup and the write, which is the service's 45 s / 3 s shape.
    budgetMs: overrides.budgetMs,
    // As the service wires it: metering and the ceiling read run on the turn's own connection.
    bindDb: (turnDb) => ({
      catalogue: { get: () => catalogue.get(turnDb) },
      meter: createMeter({ insert: llmCallsInserter(turnDb), write: (line) => lines.push(line), project: undefined }),
      tokensUsed: (buildId) => buildTokensUsed(turnDb, buildId),
    }),
    turn: {
      provider,
      model: "claude-opus-5",
      effort: "medium",
      prompts: loadPrompts(),
      tokenCeiling: overrides.tokenCeiling ?? 300_000,
      log,
    },
  };
  return { deps, provider, lines, catalogue };
}

async function newBuild(ask: string, owner: { tenantId?: string } = {}): Promise<string> {
  const [build] = await handle.db
    .insert(builds)
    .values({ askText: ask, tenantId: owner.tenantId ?? null, anonOwnerHash: owner.tenantId ? null : `anon-${Math.random()}` })
    .returning({ id: builds.id });
  await addUserMessage(build!.id, ask);
  return build!.id;
}

async function addUserMessage(buildId: string, text: string): Promise<void> {
  // Match gateway's serialized append, including the slot for intake's reply.
  await handle.db.transaction(async (tx) => {
    await tx.select({ id: builds.id }).from(builds).where(eq(builds.id, buildId)).for("update");
    await tx.insert(buildMessages).values({
      buildId, role: "user", text,
      createdAt: sql`greatest(clock_timestamp(), (SELECT max(${buildMessages.createdAt}) + interval '2 microseconds' FROM ${buildMessages} WHERE ${buildMessages.buildId} = ${buildId}))`,
    });
  });
}

const messagesOf = (buildId: string) =>
  handle.db
    .select({ role: buildMessages.role, text: buildMessages.text })
    .from(buildMessages)
    .where(eq(buildMessages.buildId, buildId))
    .orderBy(asc(buildMessages.createdAt));
const specsOf = (buildId: string) => handle.db.select().from(specs).where(eq(specs.buildId, buildId)).orderBy(asc(specs.version));
const callsOf = (buildId: string) => handle.db.select().from(llmCalls).where(eq(llmCalls.buildId, buildId));
const statusOf = async (buildId: string) => (await handle.db.select({ status: builds.status }).from(builds).where(eq(builds.id, buildId)))[0]?.status;

describe("cleanup rejection handling", () => {
  it("observes every cleanup failure while another cleanup is still pending", async () => {
    const buildId = await newBuild("A fridge temperature sensor");
    let blackhole = false;
    const lateQueries: string[] = [];
    let reachedMeter!: () => void;
    const metering = new Promise<void>(resolve => { reachedMeter = resolve; });
    const { deps, catalogue } = setup([async () => {
      blackhole = true;
      return goldenTurn("fridge-monitor", 1);
    }], { deadlineMs: 300, budgetMs: 380 });
    await catalogue.get(handle.db);
    const realClient = await handle.pool.connect();
    const proxied = new Proxy(realClient, {
      get(target, property) {
        if (property === "query") return (...args: unknown[]) => {
          if (!blackhole) return (target.query as (...args: unknown[]) => unknown).apply(target, args);
          reachedMeter();
          lateQueries.push(typeof args[0] === "string" ? args[0] : (args[0] as {text: string}).text);
          // Cleanup promises settle at different times, as independent query timeouts do.
          return new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Query read timeout")), 110));
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    deps.pool = { connect: async () => proxied } as unknown as pg.Pool;
    const entries: unknown[] = [];
    let attempts = 0;
    let serverDone: Promise<unknown> | undefined;
    const scheduler = createTurnScheduler({
      timeoutMs: 1500,
      retryDelayMs: 5,
      log: (_severity, message, data) => entries.push({ message, ...data }),
      intake: { turn: async () => {
        attempts++;
        if (attempts > 1) return { noop: true };
        serverDone = handleTurn(deps, buildId);
        try { return (await serverDone) as TurnResult; }
        catch { throw new IntakeError("intake answered 503", 503); }
      } },
    });
    // Keep real PostgreSQL setup outside the short fault schedule. Only advance
    // the test clock after metering has reached the injected failure boundary.
    // The separate lost-connection test still checks the real wall-clock budget.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const started = Date.now();
      scheduler.trigger(buildId);
      await metering;
      await vi.advanceTimersByTimeAsync(400);
      await scheduler.idle();
      await serverDone?.catch(() => undefined);
      expect(Date.now() - started).toBeLessThan(1500);
      expect(lateQueries.length).toBeGreaterThan(0);
      expect(entries.length).toBeGreaterThan(0);
      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

});

describe("shared response budget", () => {
  it("bounds pool acquisition and releases a checkout arriving after the response", async () => {
    const { deps } = setup([], { deadlineMs: 100, budgetMs: 200 });
    let deliver!: (client: pg.PoolClient) => void;
    const connecting = new Promise<pg.PoolClient>(resolve => { deliver = resolve; });
    deps.pool = { connect: () => connecting } as unknown as pg.Pool;
    const release = vi.fn();
    const query = vi.fn();
    let failure: unknown;
    try { await handleTurn(deps, "00000000-0000-4000-8000-000000000001"); } catch (error) { failure = error; }
    expect(isDatabaseUnavailable(failure)).toBe(true);
    deliver({ release, query } as unknown as pg.PoolClient);
    await connecting;
    await Promise.resolve();
    expect(release).toHaveBeenCalledWith(true);
    expect(query).not.toHaveBeenCalled();
  });
  it("does not acknowledge an unanswered second turn as noop when setup consumes its model budget", async () => {
    const buildId = await newBuild(GOLDEN_ASKS["fridge-monitor"].ask);
    const { deps } = setup([goldenTurn("fridge-monitor", 1), goldenTurn("fridge-monitor", 2)]);
    expect(await handleTurn(deps, buildId)).toMatchObject({ spec_version: 1 });
    await addUserMessage(buildId, GOLDEN_ASKS["fridge-monitor"].answer);
    deps.deadlineMs = 200;
    deps.budgetMs = 500;
    const realConnect = deps.pool.connect.bind(deps.pool);
    deps.pool = { connect: async () => {
      const client = await realConnect();
      let first = true;
      return new Proxy(client, { get(target, property) {
        if (property === "query") return async (...args: unknown[]) => {
          if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 250)); }
          return (target.query as (...args: unknown[]) => unknown).apply(target, args);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    } } as unknown as pg.Pool;
    let result: unknown, failure: unknown;
    try { result = await handleTurn(deps, buildId); } catch (error) { failure = error; }
    expect(result).toBeUndefined();
    expect((await messagesOf(buildId)).at(-1)?.role).toBe("user");
    expect(isDatabaseUnavailable(failure)).toBe(true);
  });

});
describe("handleTurn against Postgres", () => {
  it("answers a second user turn when the database clock trails recorded history", async () => {
    const { deps } = setup([goldenTurn("fridge-monitor", 1), goldenTurn("fridge-monitor", 2)]);
    const { ask, answer } = GOLDEN_ASKS["fridge-monitor"];
    const buildId = await newBuild(ask);
    await handle.db.update(buildMessages).set({ createdAt: sql`clock_timestamp() + interval '1 minute'` }).where(eq(buildMessages.buildId, buildId));
    expect(await handleTurn(deps, buildId)).toMatchObject({ spec_version: 1 });
    await addUserMessage(buildId, answer);
    expect(await handleTurn(deps, buildId)).toMatchObject({ spec_version: 2, status: "planning" });
    expect((await messagesOf(buildId)).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("golden fridge monitor: asks, then settles; writes messages, spec versions, status and metered calls", async () => {
    const { deps, provider, lines } = setup([goldenTurn("fridge-monitor", 1), goldenTurn("fridge-monitor", 2)]);
    const { ask, answer } = GOLDEN_ASKS["fridge-monitor"];
    const buildId = await newBuild(ask);
    const [build] = await handle.db.select().from(builds).where(eq(builds.id, buildId));

    const first = await handleTurn(deps, buildId);
    expect(first).toMatchObject({ spec_version: 1, status: "asking" });
    expect(await statusOf(buildId)).toBe("asking");

    await addUserMessage(buildId, answer);
    const second = await handleTurn(deps, buildId);
    expect(second).toMatchObject({ spec_version: 2, status: "planning" });
    expect(await statusOf(buildId)).toBe("planning");

    expect((await messagesOf(buildId)).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const versions = await specsOf(buildId);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0]!.openQuestions).toEqual([{ field: "power.source", question: "Will it run on a battery, or is there USB power near the fridge?" }]);
    const settled = Spec.parse(versions[1]!.data);
    expect(settled.settled).toBe(true);
    expect(settled.capabilities).toEqual(["read.temperature_c", "read.humidity_pct", "net.wifi", "power.battery"]);
    expect(versions[1]!.confidence).toBe(1);

    const calls = await callsOf(buildId);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatchObject({ stage: "intake", model: "claude-opus-5", tenantId: null, anonOwnerHash: build!.anonOwnerHash, stopReason: "end_turn" });
      expect(Number(call.costUsd)).toBeGreaterThan(0);
    }
    expect(lines.map((l) => JSON.parse(l)).map((e) => [e.event, e.build_id])).toEqual([
      ["llm_call", buildId],
      ["llm_call", buildId],
    ]);

    // Nothing left to answer: idempotent.
    expect(await handleTurn(deps, buildId)).toEqual({ noop: true });
    expect(provider.requests).toHaveLength(2);
  });

  it("copies the tenant onto llm_calls for a claimed build", async () => {
    const [tenant] = await handle.db.insert(tenants).values({ name: "Ann" }).returning({ id: tenants.id });
    const { deps } = setup([goldenTurn("presence-alert", 1)]);
    const buildId = await newBuild(GOLDEN_ASKS["presence-alert"].ask, { tenantId: tenant!.id });
    await handleTurn(deps, buildId);
    expect(await callsOf(buildId)).toMatchObject([{ tenantId: tenant!.id, anonOwnerHash: null }]);
  });

  it("returns null for a build that doesn't exist, and noop when the last message is already answered", async () => {
    const { deps, provider } = setup([]);
    expect(await handleTurn(deps, "00000000-0000-4000-8000-00000000dead")).toBeNull();
    const buildId = await newBuild("hello");
    await handle.db.insert(buildMessages).values({ buildId, role: "assistant", text: "hi" });
    expect(await handleTurn(deps, buildId)).toEqual({ noop: true });
    expect(provider.requests).toHaveLength(0);
  });

  it("concurrent calls for one message: one answers, the other is a noop, one assistant message", async () => {
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return goldenTurn("presence-alert", 1);
    };
    const { deps, provider } = setup([slow, slow]);
    const buildId = await newBuild(GOLDEN_ASKS["presence-alert"].ask);
    const results = await Promise.all([handleTurn(deps, buildId), handleTurn(deps, buildId), handleTurn(deps, buildId)]);
    expect(results.filter((r) => r !== null && "noop" in r)).toHaveLength(2);
    expect((await messagesOf(buildId)).filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(provider.requests).toHaveLength(1);
  });

  it("a message that arrives mid-turn is answered by the lock holder, not stranded", async () => {
    let buildId = "";
    const { deps, provider } = setup([
      async () => {
        // The person sends another message while the first is being answered, and
        // the gateway's call for it finds the lock taken.
        await addUserMessage(buildId, "It can plug into USB.");
        expect(await handleTurn(deps, buildId)).toEqual({ noop: true });
        return goldenTurn("presence-alert", 1);
      },
      goldenTurn("presence-alert", 2),
    ]);
    buildId = await newBuild(GOLDEN_ASKS["presence-alert"].ask);
    const result = await handleTurn(deps, buildId);
    expect(result).toMatchObject({ status: "planning", spec_version: 2 });
    // Each reply sits directly after the message it answers.
    expect(await messagesOf(buildId)).toMatchObject([
      { role: "user", text: GOLDEN_ASKS["presence-alert"].ask },
      { role: "assistant" },
      { role: "user", text: "It can plug into USB." },
      { role: "assistant" },
    ]);
    expect(provider.requests).toHaveLength(2);
  });

  it("deadline: a model call that never returns still gets exactly one fallback message", async () => {
    const { deps } = setup([hangingResponse() as Response], { deadlineMs: 200, budgetMs: 2000 });
    const buildId = await newBuild(GOLDEN_ASKS["fridge-monitor"].ask);
    const result = await handleTurn(deps, buildId);
    expect(result).toMatchObject({ spec_version: null, status: "asking" });
    expect(await messagesOf(buildId)).toEqual([
      { role: "user", text: GOLDEN_ASKS["fridge-monitor"].ask },
      { role: "assistant", text: FALLBACK_REPLY },
    ]);
    expect(await specsOf(buildId)).toEqual([]);
    expect(await callsOf(buildId)).toEqual([]);
  });

  it("deadline: work that ignores the abort signal is cut off too", async () => {
    const { deps } = setup([(() => new Promise<LlmResponse>(() => {})) as Response], { deadlineMs: 200, budgetMs: 2000 });
    const buildId = await newBuild(GOLDEN_ASKS["fridge-monitor"].ask);
    await handleTurn(deps, buildId);
    expect((await messagesOf(buildId)).filter((m) => m.role === "assistant")).toEqual([{ role: "assistant", text: FALLBACK_REPLY }]);
  });

  it("token ceiling: a spent build gets the limit reply and no model call", async () => {
    const { deps, provider } = setup([goldenTurn("fridge-monitor", 1)], { tokenCeiling: 10_000 });
    const buildId = await newBuild(GOLDEN_ASKS["fridge-monitor"].ask);
    await handle.db.insert(llmCalls).values({ buildId, anonOwnerHash: "x", stage: "intake", model: "claude-opus-5", inputTokens: 9_000, outputTokens: 1_000, costUsd: "0.07" });
    await handleTurn(deps, buildId);
    expect(provider.requests).toHaveLength(0);
    expect((await messagesOf(buildId)).at(-1)).toEqual({ role: "assistant", text: TOKEN_CEILING_REPLY });
  });

  it("out of scope by rule: refused without a model call or a spec", async () => {
    const { deps, provider } = setup([]);
    const buildId = await newBuild("switch my 230V space heater on when it's cold");
    expect(await handleTurn(deps, buildId)).toMatchObject({ spec_version: null, status: "asking" });
    expect(provider.requests).toHaveLength(0);
    expect((await messagesOf(buildId)).at(-1)).toEqual({ role: "assistant", text: outOfScopeReply("mains_voltage") });
    expect(await callsOf(buildId)).toEqual([]);
  });

  it("the route's own handler carries may_retry through: a 503, and nothing written", async () => {
    // Through buildApp and turnsHandler, exactly as server.ts wires them. A
    // direct handleTurn(..., true) call passes even when the wiring drops the
    // argument, which is how this was missed the first time.
    const failing = async (): Promise<never> => {
      throw Object.assign(new Error("overloaded"), { status: 529 });
    };
    const { deps } = setup([failing as unknown as Response, failing as unknown as Response]);
    const instance = buildApp({ turns: turnsHandler(deps), ping: async () => {}, log: createLogger({ write: () => {} }) });
    const buildId = await newBuild(GOLDEN_ASKS["fridge-monitor"].ask);

    const handed = await instance.inject({
      method: "POST",
      url: "/v1/turns",
      payload: { build_id: buildId, may_retry: true },
      headers: { "content-type": "application/json" },
    });
    expect(handed.statusCode).toBe(503);
    expect(await messagesOf(buildId)).toEqual([{ role: "user", text: GOLDEN_ASKS["fridge-monitor"].ask }]);

    // The caller's last attempt says so, and the message is answered.
    const answered = await instance.inject({
      method: "POST",
      url: "/v1/turns",
      payload: { build_id: buildId, may_retry: false },
      headers: { "content-type": "application/json" },
    });
    expect(answered.statusCode).toBe(200);
    expect((await messagesOf(buildId)).at(-1)).toEqual({ role: "assistant", text: FALLBACK_REPLY });
    await instance.close();
  });

  it("a transport failure with a retry ahead of it writes nothing and asks to be retried", async () => {
    // An error the API answered, so it isn't slowed by the transport retries in
    // callStructured (those are covered in @albusforge/llm). What decides the
    // hand-back is the failure class, which is the same either way.
    const failing = async (): Promise<never> => {
      throw Object.assign(new Error("overloaded"), { status: 529 });
    };
    const { deps } = setup([failing as unknown as Response, failing as unknown as Response]);
    const buildId = await newBuild(GOLDEN_ASKS["fridge-monitor"].ask);

    await expect(handleTurn(deps, buildId, undefined, true)).rejects.toMatchObject({ name: "TurnRetryableError" });
    // The person's message is still unanswered, so the retry can answer it properly.
    expect(await messagesOf(buildId)).toEqual([{ role: "user", text: GOLDEN_ASKS["fridge-monitor"].ask }]);
    expect(await specsOf(buildId)).toEqual([]);
  });

  it("the same failure on the last attempt writes the fallback, so no message is left unanswered", async () => {
    const failing = async (): Promise<never> => {
      throw Object.assign(new Error("overloaded"), { status: 529 });
    };
    const { deps } = setup([failing as unknown as Response, failing as unknown as Response]);
    const buildId = await newBuild(GOLDEN_ASKS["fridge-monitor"].ask);

    expect(await handleTurn(deps, buildId)).toMatchObject({ spec_version: null, status: "asking" });
    expect((await messagesOf(buildId)).at(-1)).toEqual({ role: "assistant", text: FALLBACK_REPLY });
    // It never tells the person to rephrase: nothing about their message failed.
    expect(FALLBACK_REPLY).not.toMatch(/another way|rephrase/i);
  });

  it("a failure a retry can't fix is answered straight away, retry or not", async () => {
    // Truncated twice: the same message would truncate again, so handing it
    // back would only delay the reply.
    const { deps } = setup([fakeResponse({ stop_reason: "max_tokens", text: "{" }), fakeResponse({ stop_reason: "max_tokens", text: "{" })]);
    const buildId = await newBuild(GOLDEN_ASKS["fridge-monitor"].ask);
    expect(await handleTurn(deps, buildId, undefined, true)).toMatchObject({ spec_version: null });
    expect((await messagesOf(buildId)).at(-1)).toEqual({ role: "assistant", text: FALLBACK_REPLY });
  });

  it("off topic: code writes the reply, and no spec version or clarification round is spent", async () => {
    const offTopic = fakeResponse({
      text: JSON.stringify({ reply_kind: "off_topic", spec_patch: {}, candidate_questions: [], assumptions: [], reply: "That's off topic." }),
    });
    const { deps, provider } = setup([offTopic, offTopic]);
    const buildId = await newBuild("who won the world cup in 1998?");

    expect(await handleTurn(deps, buildId)).toMatchObject({ spec_version: null, status: "asking" });
    expect((await messagesOf(buildId)).at(-1)).toEqual({ role: "assistant", text: offTopicReply(false) });
    // The model's own prose never reaches the person, so it can't answer anyway.
    expect((await messagesOf(buildId)).at(-1)?.text).not.toContain("off topic.");
    expect(await specsOf(buildId)).toEqual([]);

    // A second stray message stops rather than repeating the invitation.
    await addUserMessage(buildId, "ok but seriously, who won?");
    await handleTurn(deps, buildId);
    expect((await messagesOf(buildId)).at(-1)).toEqual({ role: "assistant", text: offTopicReply(true) });
    expect(await specsOf(buildId)).toEqual([]);
    // Both turns still cost a model call, and both are metered.
    expect(provider.requests).toHaveLength(2);
    expect(await callsOf(buildId)).toHaveLength(2);
  });

  it("off topic doesn't consume a clarification round: the build can still ask twice after one", async () => {
    const offTopic = fakeResponse({
      text: JSON.stringify({ reply_kind: "off_topic", spec_patch: {}, candidate_questions: [], assumptions: [], reply: "off topic" }),
    });
    const { deps } = setup([offTopic, goldenTurn("fridge-monitor", 1)]);
    const buildId = await newBuild("what's the weather like?");
    await handleTurn(deps, buildId);

    await addUserMessage(buildId, GOLDEN_ASKS["fridge-monitor"].ask);
    const result = await handleTurn(deps, buildId);
    // The first asking version, not the second: the stray message spent nothing.
    expect(result).toMatchObject({ spec_version: 1, status: "asking" });
    expect(Spec.parse((await specsOf(buildId)).at(-1)!.data).open_questions).toHaveLength(1);
  });

  it("round cap: after two asking versions, the third turn settles instead of asking", async () => {
    const { deps } = setup([goldenTurn("fridge-monitor", 1)]);
    const buildId = await newBuild(GOLDEN_ASKS["fridge-monitor"].ask);
    const asking = { ...emptySpec(), open_questions: [{ field: "sense.what", question: "What?" }] };
    for (const version of [1, 2]) {
      await handle.db.insert(specs).values({ buildId, version, data: asking, confidence: 0.5, openQuestions: asking.open_questions });
    }
    const result = await handleTurn(deps, buildId);
    expect(result).toMatchObject({ spec_version: 3, status: "planning" });
    const latest = Spec.parse((await specsOf(buildId)).at(-1)!.data);
    expect(latest.open_questions).toEqual([]);
    expect(latest.settled).toBe(true);
  });

  it("a refusal and a provider failure each write one safe reply and keep metering", async () => {
    const { deps } = setup([
      fakeResponse({ stop_reason: "refusal", content: [] }),
      async () => {
        throw Object.assign(new Error("overloaded"), { status: 529 });
      },
    ]);
    const buildId = await newBuild("make me a device");
    await handleTurn(deps, buildId);
    await addUserMessage(buildId, "please?");
    await handleTurn(deps, buildId);
    const assistant = (await messagesOf(buildId)).filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(2);
    expect(assistant[1]!.text).toBe(FALLBACK_REPLY);
    expect((await callsOf(buildId)).map((c) => c.stopReason)).toEqual(["refusal"]);
  });
});

describe("one connection per turn", () => {
  /*
   * Five *different* builds, so every caller takes its build's lock: none of
   * them is a noop. The barrier holds all five inside the lock at once, and
   * the pool is the service's five connections with a short acquisition
   * timeout, so a turn that needed a second connection for its reads,
   * metering or final write would wait for one that is never coming back and
   * reject before the deadline could write a fallback.
   */
  it("five distinct builds answer concurrently without exhausting the pool", async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => newBuild("A fridge temperature sensor")));
    const { deps } = setup(Array.from({ length: 5 }, () => goldenTurn("fridge-monitor", 1)));
    const timeout = handle.pool.options.connectionTimeoutMillis;
    handle.pool.options.connectionTimeoutMillis = 200;
    const original = pg.Client.prototype.query;
    let locks = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args) as Promise<unknown>;
      if (typeof args[0] === "string" && args[0].startsWith("SELECT pg_try_advisory_lock")) {
        return result.then(async (value: unknown) => {
          if (++locks === 5) release();
          await barrier;
          return value;
        });
      }
      return result;
    } as never);
    let outcomes: PromiseSettledResult<unknown>[];
    try {
      outcomes = await Promise.allSettled(ids.map((id) => handleTurn(deps, id)));
    } finally {
      spy.mockRestore();
      handle.pool.options.connectionTimeoutMillis = timeout;
    }
    expect(locks).toBe(5);
    expect(outcomes.map((r) => r.status)).toEqual(Array(5).fill("fulfilled"));
    for (const id of ids) {
      const assistant = (await messagesOf(id)).filter((m) => m.role === "assistant");
      expect(assistant).toHaveLength(1);
      // A real answer, not the fallback a failed read would have written.
      expect(assistant[0]!.text).not.toBe(FALLBACK_REPLY);
      expect(await callsOf(id)).toHaveLength(1);
    }
  });

  /*
   * The deadline lands inside metering's transaction, which is waiting on the
   * build row's lock, and the statement then times out — ordinary contention
   * crossing a deadline, not an outage. The connection is the one the reply
   * has to be written on, so unless the turn drains that work and rolls it
   * back, the write's BEGIN fails with 25P02 (`current transaction is
   * aborted`) and the user message is left unanswered.
   *
   * Its own pool: a 500 ms statement timeout, one connection, ended with the
   * test, so the session settings can't leak into any other test.
   */
  it("a deadline inside metering's transaction still writes the fallback, and the usage row is rolled back", async () => {
    const buildId = await newBuild("A fridge temperature sensor");
    const short = createDb(appConfig, { max: 1, statementTimeoutMs: 500 });
    const blocker = await handle.pool.connect();
    let reachedMeter!: () => void;
    const metering = new Promise<void>(resolve => { reachedMeter = resolve; });
    let cancellations = 0;
    const client = await short.pool.connect();
    const gated = new Proxy(client, {
      get(target, property) {
        if (property === "query") return (...args: unknown[]) => {
          const text = typeof args[0] === "string" ? args[0] : (args[0] as { text: string }).text;
          const work = (target.query as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          if (!/for update/i.test(text)) return work;
          reachedMeter();
          return work.catch(async (error: { code?: string }) => {
            if (error.code === "57014") {
              cancellations++;
              // Release only after the actual metering statement is cancelled,
              // but before its rejection permits cleanup/the fallback FK write.
              await blocker.query("ROLLBACK");
            }
            throw error;
          });
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const { deps, catalogue } = setup(
      [
        async () => {
          await blocker.query("BEGIN");
          await blocker.query("SELECT id FROM builds.builds WHERE id = $1 FOR UPDATE", [buildId]);
          return goldenTurn("fridge-monitor", 1);
        },
      ],
      // A budget with room for the wait: the blocker does let go, so the turn
      // should ride it out and answer rather than give the work to a retry.
      { deadlineMs: 250, budgetMs: 3000 },
    );
    deps.pool = { connect: async () => gated } as unknown as pg.Pool;
    // Warm the catalogue first: only the model call and metering should race the deadline.
    await catalogue.get(handle.db);

    // Advance the deadline only after real metering reaches its locked row.
    // PostgreSQL's 500ms statement_timeout remains real; JS timers are advanced
    // explicitly so a busy runner cannot reorder deadline, cancellation and release.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const pending = handleTurn(deps, buildId);
      void pending.catch(() => undefined);
      await metering;
      await vi.advanceTimersByTimeAsync(250);
      const result = await pending;
      expect(cancellations).toBe(1);

      expect(result).toMatchObject({ spec_version: null, status: "asking" });
      expect(await messagesOf(buildId)).toEqual([
        { role: "user", text: "A fridge temperature sensor" },
        { role: "assistant", text: FALLBACK_REPLY },
      ]);
      // The metering transaction was rolled back, not half-applied.
      expect(await callsOf(buildId)).toEqual([]);
      expect(await statusOf(buildId)).toBe("asking");
    } finally {
      vi.useRealTimers();
      await blocker.query("ROLLBACK").catch(() => {});
      blocker.release();
      await short.pool.end();
    }
  });

  /*
   * The other side of that deadline: the connection stops answering instead of
   * coming back, so cleanup can't finish at all. The turn's promise — that
   * gateway's retry answers the message — is only worth anything if the 503
   * arrives while gateway is still listening: it doesn't retry its own
   * timeout, because a turn it stopped waiting for may still be running.
   *
   * The real scheduler, with the production order of deadlines scaled down:
   * turn deadline < response budget < gateway's attempt deadline. The
   * connection goes quiet rather than failing, which is the worst case — there
   * is no timeout of its own to rescue the response.
   */
  it("a connection lost after the model answers: gateway gets a retryable 503 inside its attempt deadline, and retries", async () => {
    // Wider than the 48 s / 50 s the service runs with, so the assertion is
    // about the order of the deadlines, not about scheduler jitter on a busy
    // machine: the budget still has to end first.
    const GATEWAY_TIMEOUT_MS = 1500;
    const buildId = await newBuild("A fridge temperature sensor");
    let lost = false;
    const lateQueries: string[] = [];

    const { deps, catalogue } = setup(
      [
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return goldenTurn("fridge-monitor", 1);
        },
      ],
      { deadlineMs: 300, budgetMs: 380 },
    );
    await catalogue.get(handle.db);

    const client = await handle.pool.connect();
    const faulty = new Proxy(client, {
      get(target, property) {
        if (property === "query") {
          return (...args: unknown[]) => {
            const text = typeof args[0] === "string" ? args[0] : (args[0] as { text: string }).text;
            // The connection goes quiet as metering opens its transaction —
            // after the model answered, and while the turn holds the lock.
            if (!lost && !/^\s*begin/i.test(text)) return (target.query as (...a: unknown[]) => unknown).apply(target, args);
            lost = true;
            lateQueries.push(text);
            // No answer and no error: only destroying the connection ends this.
            return new Promise(() => {});
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    deps.pool = { connect: async () => faulty } as unknown as pg.Pool;

    let attempts = 0;
    let handlerMs = 0;
    let handled: ReturnType<typeof handleTurn> | undefined;
    const started = Date.now();
    const scheduler = createTurnScheduler({
      timeoutMs: GATEWAY_TIMEOUT_MS,
      retryDelayMs: 5,
      log: () => {},
      intake: {
        turn: async (): Promise<TurnResult> => {
          attempts++;
          if (attempts > 1) return { noop: true };
          handled = handleTurn(deps, buildId);
          try {
            return (await handled) as TurnResult;
          } catch (error) {
            handlerMs = Date.now() - started;
            // What app.ts answers: an unavailable database is a 503, a bug is a 500.
            throw new IntakeError("intake answered", isDatabaseUnavailable(error) ? 503 : 500);
          }
        },
      },
    });

    try {
      scheduler.trigger(buildId);
      await scheduler.idle();

      // The 503 has to arrive while gateway is still waiting, or the retry it
      // promises never runs and the message is left unanswered.
      expect(attempts).toBe(2);
      expect(handlerMs).toBeGreaterThan(0);
      expect(handlerMs).toBeLessThan(GATEWAY_TIMEOUT_MS);
      // No cleanup statement sent to a connection that stopped answering: it
      // would only add another wait to a response that is already late.
      expect(lateQueries.filter((q) => /ROLLBACK|advisory_unlock/i.test(q))).toEqual([]);
      // And the usage row from the lost transaction is not there.
      expect(await callsOf(buildId)).toEqual([]);
      // The connection was destroyed, so the advisory lock went with it: a
      // later call takes the lock rather than reading a noop off a stale one.
      const { deps: next } = setup([goldenTurn("fridge-monitor", 1)]);
      expect(await handleTurn(next, buildId)).toMatchObject({ status: "asking" });
    } finally {
      await handled?.catch(() => undefined);
    }
  });
});

describe("usage attribution across a sign-up (ADR 0009)", () => {
  /** The claim transaction: the build and the usage it has so far move to the tenant. */
  async function claim(buildId: string, tenantId: string): Promise<void> {
    await handle.db.transaction(async (tx) => {
      await tx.update(builds).set({ tenantId, anonOwnerHash: null }).where(eq(builds.id, buildId));
      await tx.update(llmCalls).set({ tenantId, anonOwnerHash: null }).where(eq(llmCalls.buildId, buildId));
    });
  }

  const newTenant = async (name: string) => (await handle.db.insert(tenants).values({ name }).returning({ id: tenants.id }))[0]!.id;

  it("claim during the model call: the usage inserted after it belongs to the new tenant", async () => {
    const tenantId = await newTenant("Claim during turn");
    const buildId = await newBuild("A fridge temperature sensor");
    const { deps } = setup([
      async () => {
        await claim(buildId, tenantId);
        return goldenTurn("fridge-monitor", 1);
      },
    ]);
    await handleTurn(deps, buildId);
    expect(await callsOf(buildId)).toMatchObject([{ tenantId, anonOwnerHash: null }]);
  });

  it("claim after the turn: the claim re-attributes the row the turn wrote", async () => {
    const tenantId = await newTenant("Claim after turn");
    const buildId = await newBuild("A fridge temperature sensor");
    const { deps } = setup([goldenTurn("fridge-monitor", 1)]);
    await handleTurn(deps, buildId);
    expect(await callsOf(buildId)).toMatchObject([{ tenantId: null }]);
    await claim(buildId, tenantId);
    expect(await callsOf(buildId)).toMatchObject([{ tenantId, anonOwnerHash: null }]);
  });

  it("claim between a call and its repair retry: every row of the turn ends up with the tenant", async () => {
    const tenantId = await newTenant("Claim mid-retry");
    const buildId = await newBuild("A fridge temperature sensor");
    const { deps } = setup([
      fakeResponse({ text: "sorry, here it is: {" }),
      async () => {
        await claim(buildId, tenantId);
        return goldenTurn("fridge-monitor", 1);
      },
    ]);
    await handleTurn(deps, buildId);
    const calls = await callsOf(buildId);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => [c.tenantId, c.anonOwnerHash])).toEqual([
      [tenantId, null],
      [tenantId, null],
    ]);
  });
});

it("publishes a new spec only after admitted plan acceptance releases the build lock", async () => {
  const { createHash, randomBytes, randomUUID } = await import("node:crypto");
  const { SESSION_COOKIE } = await import("@albusforge/schema");
  const { fixture } = await import("../../matcher/src/fixtures");
  const { createBuildPlanStore } = await import("../../gateway/src/build-plan-store");
  const input = fixture();
  const tenant = randomUUID(), user = randomUUID(), token = randomBytes(32).toString("base64url");
  await handle.pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'acceptance test')", [tenant]);
  await handle.pool.query("INSERT INTO users.users(id,email) VALUES($1,$2)", [user, `${user}@example.test`]);
  await handle.pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenant,user]);
  await handle.pool.query("INSERT INTO users.sessions(token_hash,user_id,active_tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash("sha256").update(token).digest("hex"),user,tenant]);
  const buildId = await newBuild("Change this temperature monitor", {tenantId:tenant});
  const spec = {...emptySpec(),settled:true,capabilities:input.spec.capabilities,sense:{what:["temperature"],interval_s:input.spec.interval_s},connect:{transport:input.spec.transport,experience:[]},power:{source:input.spec.power_source},open_questions:[]};
  await handle.pool.query("INSERT INTO builds.specs(build_id,version,data,confidence) VALUES($1,1,$2,1)", [buildId,JSON.stringify(spec)]);
  const planning = createDb(appConfig, {max:2,statementTimeoutMs:4000});
  let release!:()=>void;
  const gate = new Promise<void>(resolve=>{release=resolve;});
  try {
    for (const part of input.parts) await handle.pool.query("UPDATE registry.parts SET status='active',definition=$3 WHERE id=$1 AND version=$2", [part.id,part.version,JSON.stringify(part)]);
    for (const row of input.compat) await handle.pool.query("INSERT INTO registry.compat_matrix(driver_pkg,driver_ver,runtime_ver,brain_id,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [row.driver_pkg,row.driver_ver,row.runtime_ver,row.brain_id,row.status]);
    const store=createBuildPlanStore(planning.pool,{schema_version:1,runtime:input.spec.runtime,profiles:input.profiles,connectors:input.connectors});
    const cookie=`${SESSION_COOKIE}=${token}`, body={expected_tenant_id:tenant,spec_version:1};
    const solved=await store.solve(cookie,"localhost",buildId,body);
    expect(solved.status).toBe("solved");
    let releaseModel!:()=>void, modelEntered!:()=>void;
    const modelGate=new Promise<void>(resolve=>{releaseModel=resolve;});
    const modelRunning=new Promise<void>(resolve=>{modelEntered=resolve;});
    const {deps}=setup([async()=>{modelEntered();await modelGate;return goldenTurn("fridge-monitor",1);}]);
    // Start before acceptance, after the turn's initial status UPDATE. Metering
    // is inert here so the schedule isolates final spec publication.
    const bind = deps.bindDb;
    deps.bindDb = db => ({...bind(db),meter:createMeter({insert:async()=>{},write:()=>{},project:undefined})});
    const turn=handleTurn(deps,buildId);
    await modelRunning;
    let entered!:()=>void;const locked=new Promise<void>(resolve=>{entered=resolve;});
    planning.pool.once("acquire",client=>{
      const original=client.query;
      client.query=((...args:unknown[])=>{
        if(typeof args[0]==="string"&&args[0].startsWith("SELECT * FROM builds.plans")){
          client.query=original;entered();return gate.then(()=>Reflect.apply(original,client,args));
        }
        return Reflect.apply(original,client,args);
      }) as typeof client.query;
    });
    const accepting=store.accept(cookie,"localhost",buildId,solved.plans[0]!.version,body);
    await locked;
    releaseModel();
    let waiting=false;
    for(let i=0;i<150;i++){
      waiting=Boolean((await handle.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FOR UPDATE%' AND query LIKE '%builds%'")).rowCount);
      if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    expect(waiting).toBe(true);
    expect((await specsOf(buildId)).map(row=>row.version)).toEqual([1]);
    expect((await handle.pool.query("SELECT 1 FROM builds.build_messages WHERE build_id=$1 AND role='assistant'",[buildId])).rowCount).toBe(0);
    release();
    expect((await accepting).accepted_at).not.toBeNull();
    await turn;
    expect((await specsOf(buildId)).at(-1)?.version).toBe(2);
    const page=await store.list(cookie,"localhost",buildId);
    expect(page.current_spec_version).toBe(2);
    expect(page.plans[0]!.spec_version).toBe(1);
  } finally {
    release();await planning.pool.end();
    await handle.pool.query("DELETE FROM registry.compat_matrix");
    await handle.pool.query("DELETE FROM registry.parts");
    await loadParts(handle.db,readValidatedParts(REGISTRY_ROOT));
  }
});
