/*
 * A live intake turn against the real model, for checking prompt behaviour that
 * fixtures cannot: does it ask ONE question, and are its one-tap options any good?
 * Not a test — nothing here is asserted, and it spends API credit. Run by hand.
 */
import { createAnthropicProvider } from "@albusforge/llm";
import { memoryMeter } from "@albusforge/llm/testing";
import { loadParts } from "@albusforge/registry/load";
import { createCatalogueCache } from "../src/catalogue";
import { createLogger } from "../src/log";
import { loadPrompts } from "../src/prompts";
import { runTurn, type TranscriptMessage, type TurnContext } from "../src/turn";

const ASKS = [
  "I want a sensor that tells me when my greenhouse soil is dry",
  "Send me a notification when someone walks into my hallway.",
  "Water my houseplant automatically when the soil gets dry.",
];

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

const meter = memoryMeter();
const ctx: TurnContext = {
  provider: createAnthropicProvider({ apiKey }),
  model: "claude-opus-5",
  effort: "medium",
  meter,
  catalogue: createCatalogueCache({ source: async () => loadParts(), includeDrafts: true }),
  prompts: loadPrompts(),
  tokenCeiling: 300_000,
  tokensUsed: async () => meter.records.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0),
  log: createLogger({ write: () => {} }),
};

for (const [index, ask] of ASKS.entries()) {
  const buildId = `00000000-0000-4000-8000-00000000000${index + 1}`;
  const transcript: TranscriptMessage[] = [{ role: "user", text: ask }];
  const turn = await runTurn(ctx, {
    buildId,
    attribution: { buildId, tenantId: null, anonOwnerHash: "live-probe" },
    transcript,
    previous: null,
    roundsUsed: 0,
    signal: AbortSignal.timeout(90_000),
  });
  console.log(`\n=== ask: ${ask}`);
  if (turn.kind !== "spec") {
    console.log(`  turn was ${turn.reason}: ${turn.reply}`);
    continue;
  }
  console.log(`  reply: ${turn.decision.reply}`);
  for (const q of turn.decision.spec.open_questions) {
    console.log(`  question [${q.field}]: ${q.question}`);
    console.log(`    options: ${q.options ? JSON.stringify(q.options) : "(none — open-ended)"}`);
  }
  console.log(`  questions asked: ${turn.decision.spec.open_questions.length}`);
}
const tokens = meter.records.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
console.log(`\ncalls: ${meter.records.length}, tokens: ${tokens}`);
