/*
 * Golden asks → expected questions → expected specs, for the three builds the
 * MVP registry covers (ARCHITECTURE.md §4.1, §12.6). The model is replayed
 * from fixtures; everything after it (scope filter, catalogue, merge,
 * vocabulary check, question filter, settling) is the real code.
 */
import { memoryMeter, replayProvider } from "@albusforge/llm/testing";
import { GOLDEN_BUILDS } from "@albusforge/registry/golden-builds";
import { loadParts } from "@albusforge/registry/load";
import { describe, expect, it } from "vitest";
import { createCatalogueCache } from "../src/catalogue";
import { createLogger } from "../src/log";
import { loadPrompts } from "../src/prompts";
import { runTurn, type TranscriptMessage, type TurnContext } from "../src/turn";
import { GOLDEN_ASKS, type GoldenBuildId, goldenTurn } from "./fixtures";

const parts = loadParts();

function context(responses: ReturnType<typeof goldenTurn>[]) {
  const provider = replayProvider(responses);
  const meter = memoryMeter();
  const ctx: TurnContext = {
    provider,
    model: "claude-opus-5",
    effort: "medium",
    meter,
    // Every MVP part is a draft today; staging runs with REGISTRY_INCLUDE_DRAFTS=true.
    catalogue: createCatalogueCache({ source: async () => parts, includeDrafts: true }),
    prompts: loadPrompts(),
    tokenCeiling: 300_000,
    tokensUsed: async () => meter.records.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0),
    log: createLogger({ write: () => {} }),
  };
  return { ctx, provider, meter };
}

const attribution = (buildId: string) => ({ buildId, tenantId: null, anonOwnerHash: "golden-anon" });

async function converse(build: GoldenBuildId) {
  const { ctx, provider, meter } = context([goldenTurn(build, 1), goldenTurn(build, 2)]);
  const buildId = `00000000-0000-4000-8000-00000000000${Object.keys(GOLDEN_ASKS).indexOf(build) + 1}`;
  const transcript: TranscriptMessage[] = [{ role: "user", text: GOLDEN_ASKS[build].ask }];

  const first = await runTurn(ctx, { buildId, attribution: attribution(buildId), transcript, previous: null, roundsUsed: 0, signal: new AbortController().signal });
  if (first.kind !== "spec") throw new Error(`turn 1 of ${build} was ${first.reason}`);
  transcript.push({ role: "assistant", text: first.decision.reply }, { role: "user", text: GOLDEN_ASKS[build].answer });

  const second = await runTurn(ctx, {
    buildId,
    attribution: attribution(buildId),
    transcript,
    previous: first.decision.spec,
    roundsUsed: first.decision.spec.open_questions.length > 0 ? 1 : 0,
    signal: new AbortController().signal,
  });
  if (second.kind !== "spec") throw new Error(`turn 2 of ${build} was ${second.reason}`);
  return { first: first.decision, second: second.decision, provider, meter };
}

describe.each(Object.keys(GOLDEN_ASKS) as GoldenBuildId[])("golden ask: %s", (build) => {
  const golden = GOLDEN_BUILDS.find((g) => g.id === build)!;

  it("asks exactly one question, about the power source, in round one", async () => {
    const { first } = await converse(build);
    expect(first.status).toBe("asking");
    expect(first.spec.open_questions.map((q) => q.field)).toEqual(["power.source"]);
    expect(first.spec.settled).toBe(false);
  });

  it("settles on the answer with every capability the golden build requires", async () => {
    const { second } = await converse(build);
    expect(second.status).toBe("planning");
    expect(second.spec.settled).toBe(true);
    expect(second.spec.open_questions).toEqual([]);
    expect(new Set(second.spec.capabilities)).toEqual(new Set(golden.requires.filter((c) => !c.startsWith("power.")).concat(golden.power.supply)));
  });

  it("sends the catalogue in the cached prefix and the ask only as a user turn", async () => {
    const { provider, meter } = await converse(build);
    const [request] = provider.requests;
    const system = request!.system as { text: string; cache_control?: unknown }[];
    expect(system.at(-1)?.text).toContain("# Part catalogue");
    expect(system.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    expect(JSON.stringify(system)).not.toContain(GOLDEN_ASKS[build].ask);
    expect(request!.messages[0]).toEqual({ role: "user", content: GOLDEN_ASKS[build].ask });
    expect(request!.messages.at(-1)?.role).toBe("system");
    // The prefix is byte-identical on the second turn, so it can be read from cache.
    expect(provider.requests[1]!.system).toEqual(request!.system);
    expect(meter.records.map((r) => r.stage)).toEqual(["intake", "intake"]);
  });
});

describe("golden ask details", () => {
  it("plant waterer: drops an off-menu capability and an irrelevant question, and says so", async () => {
    const { first } = await converse("plant-waterer");
    expect(first.droppedCapabilities).toEqual(["act.pump_ml"]);
    expect(first.spec.assumptions).toContain("Left out, not in the parts catalogue: act.pump_ml");
    expect(first.reply).not.toContain("chart");
    expect(first.reply).toContain("USB outlet");
    expect(first.spec.act).toEqual({ what: ["turn a valve to water the plant"] });
  });

  it("fridge monitor: keeps the model's reply when every question survived, and the battery target", async () => {
    const { first, second } = await converse("fridge-monitor");
    expect(first.reply).toMatch(/^A fridge monitor/);
    expect(second.spec.power).toEqual({ source: "battery", target_life_days: 90 });
    expect(second.spec.sense).toEqual({ what: ["temperature", "humidity"], interval_s: 300 });
  });
});
