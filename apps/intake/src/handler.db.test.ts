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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOLDEN_ASKS, goldenTurn } from "../test/fixtures";
import { createCatalogueCache, dbPartsSource } from "./catalogue";
import { emptySpec } from "./decide";
import { handleTurn, type HandlerDeps } from "./handler";
import { createLogger } from "./log";
import { loadPrompts } from "./prompts";
import { FALLBACK_REPLY, outOfScopeReply, TOKEN_CEILING_REPLY } from "./replies";

let container: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;

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
  handle = createDb({ ...migrate, user: "albus_app", password: "app-secret" }, { max: 5, statementTimeoutMs: 10_000 });
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
}

type Response = LlmResponse | ((request: never, signal?: AbortSignal) => Promise<LlmResponse>);

function setup(responses: Response[], overrides: { deadlineMs?: number; tokenCeiling?: number } = {}): Setup {
  const provider = replayProvider(responses as Parameters<typeof replayProvider>[0]);
  const lines: string[] = [];
  const log = createLogger({ write: () => {} });
  const deps: HandlerDeps = {
    db: handle.db,
    pool: handle.pool,
    log,
    deadlineMs: overrides.deadlineMs ?? 45_000,
    turn: {
      provider,
      model: "claude-opus-5",
      effort: "medium",
      meter: createMeter({ insert: llmCallsInserter(handle.db), write: (line) => lines.push(line), project: undefined }),
      catalogue: createCatalogueCache({ source: dbPartsSource(handle.db), includeDrafts: true }),
      prompts: loadPrompts(),
      tokenCeiling: overrides.tokenCeiling ?? 300_000,
      tokensUsed: (buildId) => buildTokensUsed(handle.db, buildId),
      log,
    },
  };
  return { deps, provider, lines };
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
