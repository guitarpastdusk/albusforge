/*
 * A private message never reaches a log line (ASK-TO-ENCLOSURE.md §3).
 *
 * Every case here drives the real failure-to-logger path — runTurn, the real
 * callStructured, the real logger — with a synthetic marker standing in for
 * the person's words, and asserts the marker appears in no log field. The
 * dangerous ones are the paths that carry text *about* the failure: Node's
 * JSON parse error quotes an excerpt of the text it rejected, an API error's
 * message can echo the request, and a database error can carry the row.
 */
import { type LlmProvider, type Meter } from "@albusforge/llm";
import { fakeResponse, memoryMeter, replayProvider } from "@albusforge/llm/testing";
import { loadParts } from "@albusforge/registry/load";
import { describe, expect, it } from "vitest";
import { createCatalogueCache } from "../src/catalogue";
import { createLogger } from "../src/log";
import { loadPrompts } from "../src/prompts";
import { runTurn, type TurnContext, type TurnOutcome } from "../src/turn";
import { goldenTurn } from "./fixtures";

/** Stands in for anything private: the person's words, or model text quoting them. */
const PRIVATE = "PRIVATE_HOME";
const BUILD_ID = "00000000-0000-4000-8000-000000000001";
const parts = loadParts();

interface Run {
  outcome: TurnOutcome;
  lines: string[];
}

async function run(provider: LlmProvider, meter: Meter = memoryMeter()): Promise<Run> {
  const lines: string[] = [];
  const ctx: TurnContext = {
    provider,
    model: "claude-opus-5",
    effort: "medium",
    meter,
    catalogue: createCatalogueCache({ source: async () => parts, includeDrafts: true }),
    prompts: loadPrompts(),
    tokenCeiling: 300_000,
    tokensUsed: async () => 0,
    log: createLogger({ project: "albusforge-staging", write: (line) => lines.push(line) }),
  };
  const outcome = await runTurn(ctx, {
    buildId: BUILD_ID,
    attribution: { buildId: BUILD_ID, tenantId: null, anonOwnerHash: "anon" },
    // The person's words, which the model then echoes back at us.
    transcript: [{ role: "user", text: `temperature sensor at ${PRIVATE}` }],
    previous: null,
    roundsUsed: 0,
    signal: new AbortController().signal,
  });
  return { outcome, lines };
}

describe("private text and log lines", () => {
  it("does not log private model text from a JSON parse failure", async () => {
    const response = fakeResponse({ content: [{ type: "text", text: PRIVATE, citations: null }] });
    const { outcome, lines } = await run(replayProvider([response, response]));

    expect(outcome).toMatchObject({ kind: "reply", reason: "invalid_output" });
    expect(lines.join("\n")).not.toContain(PRIVATE);
    // What is left is enough to classify the failure.
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ severity: "WARNING", failure: "invalid_output", reason: "invalid_json", calls: 2 });
  });

  it("logs schema paths and issue codes for a schema mismatch, never the value that failed", async () => {
    const response = fakeResponse({ content: [{ type: "text", text: JSON.stringify({ reply: PRIVATE }), citations: null }] });
    const { outcome, lines } = await run(replayProvider([response, response]));

    expect(outcome).toMatchObject({ kind: "reply", reason: "invalid_output" });
    expect(lines.join("\n")).not.toContain(PRIVATE);
    const entry = JSON.parse(lines.at(-1)!);
    expect(entry.reason).toBe("schema_mismatch");
    expect(entry.paths).toContain("spec_patch");
    expect(entry.codes.length).toBeGreaterThan(0);
  });

  it("logs a provider error's class, status and request id, never its message or stack", async () => {
    const provider: LlmProvider = {
      name: "anthropic",
      create: async () => {
        throw Object.assign(new Error(`400 {"error":{"message":"bad request: ${PRIVATE}"}}`), {
          name: "BadRequestError",
          status: 400,
          request_id: "req_123",
        });
      },
    };
    const { outcome, lines } = await run(provider);

    expect(outcome).toMatchObject({ kind: "reply", reason: "provider_error" });
    expect(lines.join("\n")).not.toContain(PRIVATE);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({
      severity: "ERROR",
      failure: "provider_error",
      reason: "provider_error",
      errorName: "BadRequestError",
      status: 400,
      requestId: "req_123",
    });
  });

  it("logs a failed usage insert by class and SQLSTATE, never the database error's message", async () => {
    const failing: Meter = {
      record: async () => {
        // What a driver hands back: the statement and the row are in the message.
        throw Object.assign(new Error(`insert into "llm_calls" failed: value "${PRIVATE}" violates check`), { code: "23514" });
      },
    };
    const { outcome, lines } = await run(replayProvider([goldenTurn("fridge-monitor", 1)]), failing);

    // The turn still succeeds: a lost usage row doesn't lose the person's answer.
    expect(outcome.kind).toBe("spec");
    expect(lines.join("\n")).not.toContain(PRIVATE);
    const entry = JSON.parse(lines.find((line) => line.includes("llm call not stored"))!);
    expect(entry.error).toMatchObject({ name: "Error", code: "23514", redacted: true });
    expect(entry.error.message).toBeUndefined();
    expect(entry.stack).toBeUndefined();
  });
});
