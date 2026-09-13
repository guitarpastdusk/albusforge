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
import { asc, eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GOLDEN_ASKS, goldenTurn } from "../test/fixtures";
import { type CatalogueCache, createCatalogueCache, dbPartsSource } from "./catalogue";
import { emptySpec } from "./decide";
import { handleTurn, type HandlerDeps } from "./handler";
import { createLogger } from "./log";
import { loadPrompts } from "./prompts";
import { FALLBACK_REPLY, outOfScopeReply, TOKEN_CEILING_REPLY } from "./replies";

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

function setup(responses: Response[], overrides: { deadlineMs?: number; tokenCeiling?: number } = {}): Setup {
  const provider = replayProvider(responses as Parameters<typeof replayProvider>[0]);
  const catalogue = createCatalogueCache({ source: dbPartsSource(), includeDrafts: true });
  const lines: string[] = [];
  const log = createLogger({ write: () => {} });
  const deps: HandlerDeps = {
    pool: handle.pool,
    log,
    deadlineMs: overrides.deadlineMs ?? 45_000,
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
  await handle.db.insert(buildMessages).values({ buildId, role: "user", text });
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

describe("handleTurn against Postgres", () => {
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
    const { deps } = setup([hangingResponse() as Response], { deadlineMs: 200 });
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
    const { deps } = setup([(() => new Promise<LlmResponse>(() => {})) as Response], { deadlineMs: 200 });
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
    let unblocked: Promise<void> | undefined;

    const { deps, catalogue } = setup(
      [
        async () => {
          await blocker.query("BEGIN");
          await blocker.query("SELECT id FROM builds.builds WHERE id = $1 FOR UPDATE", [buildId]);
          unblocked = new Promise<void>((resolve, reject) => {
            setTimeout(() => void blocker.query("ROLLBACK").then(() => resolve(), reject), 650);
          });
          return goldenTurn("fridge-monitor", 1);
        },
      ],
      { deadlineMs: 250 },
    );
    deps.pool = short.pool;
    // Warm the catalogue first: only the model call and metering should race the deadline.
    await catalogue.get(handle.db);

    try {
      const result = await handleTurn(deps, buildId);
      if (unblocked) await unblocked;

      expect(result).toMatchObject({ spec_version: null, status: "asking" });
      expect(await messagesOf(buildId)).toEqual([
        { role: "user", text: "A fridge temperature sensor" },
        { role: "assistant", text: FALLBACK_REPLY },
      ]);
      // The metering transaction was rolled back, not half-applied.
      expect(await callsOf(buildId)).toEqual([]);
      expect(await statusOf(buildId)).toBe("asking");
    } finally {
      await blocker.query("ROLLBACK").catch(() => {});
      blocker.release();
      await short.pool.end();
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
