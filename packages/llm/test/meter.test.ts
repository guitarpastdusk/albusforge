import { describe, expect, it } from "vitest";
import { createMeter, formatLlmCallLine, type LlmCallRecord } from "../src/meter";
import { costUsd, priceFor, PRICES_USD_PER_MTOK } from "../src/pricing";
import { createProvider, createVertexProvider } from "../src/provider";
import { fakeResponse } from "../src/testing";
import type { LlmUsage } from "../src/types";
import { fixture } from "./fixtures";

const TRACE = "0123456789abcdef0123456789abcdef";

describe("pricing", () => {
  it("prices Opus 5 at the published rates, cache reads and writes included", () => {
    expect(PRICES_USD_PER_MTOK["claude-opus-5"]).toEqual({ input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 });
    // 412 in, 640 out, 2310 written to the 5-minute cache.
    const expected = (412 * 5 + 640 * 25 + 2310 * 6.25) / 1e6;
    // Rounded to the column's six decimals.
    expect(costUsd(fixture("valid").usage, "claude-opus-5")).toBe(Math.round(expected * 1e6) / 1e6);
  });

  it("prices cache reads at 0.1x and 1-hour writes at 2x", () => {
    const usage = {
      ...fakeResponse().usage,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 },
    } as LlmUsage;
    expect(costUsd(usage, "claude-opus-5")).toBe(0.5 + 10);
  });

  it("prices each fallback iteration at the model that ran it", () => {
    const usage = {
      ...fakeResponse().usage,
      iterations: [
        { type: "message", model: "claude-opus-5", input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        { type: "compaction", input_tokens: 999_999, output_tokens: 999_999 },
      ],
    } as unknown as LlmUsage;
    expect(costUsd(usage, "claude-opus-4-8")).toBeCloseTo((1000 * 5 + 100 * 25) / 1e6, 6);
  });

  it("prices an unknown model at the most expensive row, never zero", () => {
    expect(priceFor("claude-future-9")).toEqual({ price: PRICES_USD_PER_MTOK["claude-fable-5-1"], known: false });
  });
});

describe("the llm_call log line", () => {
  const record: LlmCallRecord = {
    stage: "intake",
    model: "claude-opus-5",
    costUsd: 0.032498,
    inputTokens: 412,
    outputTokens: 640,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 2310,
    stopReason: "end_turn",
    buildId: "b1",
    tenantId: null,
    anonOwnerHash: "anon",
  };

  it("has exactly the fields infra's spend metric reads, in order", () => {
    const line = formatLlmCallLine(record, undefined, undefined);
    expect(line).toBe(
      '{"severity":"INFO","message":"llm call","event":"llm_call","stage":"intake","model":"claude-opus-5","cost_usd":0.032498,"input_tokens":412,"output_tokens":640,"cache_read_input_tokens":0,"cache_creation_input_tokens":2310,"stop_reason":"end_turn","build_id":"b1"}\n',
    );
    expect(typeof JSON.parse(line).cost_usd).toBe("number");
  });

  it("adds the trace field only with a project, and never attribution hashes", () => {
    const entry = JSON.parse(formatLlmCallLine(record, { traceId: TRACE }, "albusforge-staging"));
    expect(entry["logging.googleapis.com/trace"]).toBe(`projects/albusforge-staging/traces/${TRACE}`);
    expect(JSON.stringify(entry)).not.toContain("anon");
  });

  it("createMeter logs before inserting, so a failed insert still leaves the spend line", async () => {
    const lines: string[] = [];
    const unknown: string[] = [];
    const meter = createMeter({
      insert: async () => {
        throw new Error("db down");
      },
      write: (l) => lines.push(l),
      project: undefined,
      onUnknownModel: (m) => unknown.push(m),
    });
    await expect(meter.record("intake", fakeResponse({ model: "claude-opus-5" }), { buildId: "b1", tenantId: null, anonOwnerHash: "a" })).rejects.toThrow(
      "db down",
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "llm_call", model: "claude-opus-5", input_tokens: 100, output_tokens: 50 });
    expect(unknown).toEqual([]);
  });
});

describe("providers", () => {
  it("vertex is a stub that refuses to start", () => {
    expect(() => createVertexProvider()).toThrow(expect.objectContaining({ code: "NOT_IMPLEMENTED" }));
    expect(() => createProvider("vertex", {})).toThrow(/not implemented/);
  });

  it("anthropic requires a key, and is never built under vitest", () => {
    expect(() => createProvider("anthropic", {})).toThrow(/ANTHROPIC_API_KEY is required/);
    expect(() => createProvider("anthropic", { apiKey: "not-a-real-key" })).toThrow(/disabled under vitest/);
  });
});
