import { SpecTurn } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { callStructured, type CallDiagnostic, type CallOptions } from "../src/call";
import { prefixHash } from "../src/request";
import { hangingResponse, memoryMeter, replayProvider } from "../src/testing";
import type { LlmMessage, LlmProvider, LlmRoute } from "../src/types";
import { fixture } from "./fixtures";

const route: LlmRoute = {
  name: "test.extract.v1",
  stage: "intake",
  system: "system prompt",
  cachedContext: "catalogue",
  effort: "medium",
  maxTokens: 8000,
  retryMaxTokens: 16000,
};

const messages: LlmMessage[] = [{ role: "user", content: "keep my fridge cold and tell me if it isn't" }];
const attribution = { buildId: "00000000-0000-4000-8000-000000000001", tenantId: null, anonOwnerHash: "anon" };

function setup(provider: LlmProvider, extra: Partial<CallOptions> = {}) {
  const meter = memoryMeter();
  const options: CallOptions = { provider, model: "claude-opus-5", meter, attribution, ...extra };
  return { meter, run: () => callStructured(route, SpecTurn, messages, options) };
}

describe("callStructured", () => {
  it("returns the parsed value on a valid end_turn, metering the call", async () => {
    const provider = replayProvider([fixture("valid")]);
    const { meter, run } = setup(provider);
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spec_patch.capabilities).toEqual(["read.temperature_c", "read.humidity_pct", "net.wifi"]);
    expect(result.calls).toBe(1);
    expect(meter.records).toHaveLength(1);
    expect(meter.records[0]).toMatchObject({ stage: "intake", model: "claude-opus-5", outputTokens: 640, buildId: attribution.buildId });
  });

  it("refusal: stops without retrying, and still meters", async () => {
    const provider = replayProvider([fixture("refusal")]);
    const { meter, run } = setup(provider);
    expect(await run()).toEqual({ ok: false, failure: "refusal", calls: 1 });
    expect(provider.requests).toHaveLength(1);
    expect(meter.records[0]?.stopReason).toBe("refusal");
  });

  it("max_tokens: retries once with the larger limit, then succeeds", async () => {
    const provider = replayProvider([fixture("max-tokens"), fixture("valid")]);
    const { meter, run } = setup(provider);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(provider.requests.map((r) => r.max_tokens)).toEqual([8000, 16000]);
    // The retry resends the same transcript: a truncation isn't a repair.
    expect(provider.requests[1]?.messages).toEqual(messages);
    expect(meter.records.map((r) => r.stopReason)).toEqual(["max_tokens", "end_turn"]);
  });

  it("max_tokens twice: gives up with the safe failure", async () => {
    const provider = replayProvider([fixture("max-tokens"), fixture("max-tokens")]);
    const { meter, run } = setup(provider);
    expect(await run()).toEqual({ ok: false, failure: "max_tokens", calls: 2 });
    expect(meter.records).toHaveLength(2);
  });

  it("invalid JSON: one repair retry carrying the error, then the safe failure", async () => {
    const provider = replayProvider([fixture("invalid-json"), fixture("invalid-json")]);
    const { meter, run } = setup(provider);
    const result = await run();
    expect(result).toMatchObject({ ok: false, failure: "invalid_output", calls: 2 });
    const repair = provider.requests[1]!.messages;
    expect(repair.slice(0, messages.length)).toEqual(messages);
    expect(repair.at(-2)).toEqual({ role: "assistant", content: "Sure! Here is the spec: {spec_patch: {}}" });
    expect(repair.at(-1)?.role).toBe("user");
    expect(String(repair.at(-1)?.content)).toContain("Not valid JSON");
    expect(meter.records).toHaveLength(2);
  });

  it("schema mismatch: the repair message names the failing paths", async () => {
    const provider = replayProvider([fixture("schema-mismatch"), fixture("schema-mismatch")]);
    const { run } = setup(provider);
    expect(await run()).toMatchObject({ ok: false, failure: "invalid_output", calls: 2 });
    const content = String(provider.requests[1]!.messages.at(-1)?.content);
    expect(content).toContain("Schema mismatch");
    expect(content).toContain("spec_patch.connect.transport");
    expect(content).toContain("reply");
  });

  it("repair success: a bad first answer and a valid second one returns the value", async () => {
    const provider = replayProvider([fixture("schema-mismatch"), fixture("valid")]);
    const { meter, run } = setup(provider);
    const result = await run();
    expect(result).toMatchObject({ ok: true, calls: 2 });
    expect(meter.records).toHaveLength(2);
  });

  it("never makes more than three calls (truncation retry plus repair)", async () => {
    const provider = replayProvider([fixture("max-tokens"), fixture("invalid-json"), fixture("invalid-json"), fixture("valid")]);
    const { run } = setup(provider);
    expect(await run()).toMatchObject({ ok: false, failure: "invalid_output", calls: 3 });
    expect(provider.requests).toHaveLength(3);
  });

  it("token ceiling: no call once the build's budget is spent", async () => {
    const provider = replayProvider([fixture("valid")]);
    const { meter, run } = setup(provider, { tokenCeiling: { limit: 1000, used: async () => 1000 } });
    expect(await run()).toEqual({ ok: false, failure: "token_ceiling", calls: 0 });
    expect(provider.requests).toHaveLength(0);
    expect(meter.records).toHaveLength(0);
  });

  it("token ceiling: re-checked before a retry", async () => {
    let used = 0;
    const provider = replayProvider([fixture("max-tokens"), fixture("valid")]);
    const meter = memoryMeter();
    const result = await callStructured(route, SpecTurn, messages, {
      provider,
      model: "claude-opus-5",
      attribution,
      meter: {
        async record(call, response, a) {
          used += response.usage.input_tokens + response.usage.output_tokens;
          return meter.record(call, response, a);
        },
      },
      tokenCeiling: { limit: 5000, used: async () => used },
    });
    expect(result).toEqual({ ok: false, failure: "token_ceiling", calls: 1 });
    expect(provider.requests).toHaveLength(1);
  });

  it("deadline: an aborted signal cancels the in-flight request", async () => {
    const provider = replayProvider([hangingResponse()]);
    const controller = new AbortController();
    const { meter, run } = setup(provider, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(await run()).toMatchObject({ ok: false, failure: "deadline", calls: 0 });
    expect(meter.records).toHaveLength(0);
  });

  it("provider errors come back as a failure, not a throw", async () => {
    const provider: LlmProvider = {
      name: "anthropic",
      create: async () => {
        throw Object.assign(new Error("overloaded"), { status: 529 });
      },
    };
    const { run } = setup(provider);
    expect(await run()).toMatchObject({ ok: false, failure: "provider_error", calls: 0 });
  });

  it("meters every call with the route's prefix hash, and a changed prefix changes it", async () => {
    const { meter, run } = setup(replayProvider([fixture("valid")]));
    await run();
    expect(meter.records[0]?.prefixHash).toBe(prefixHash(route));

    const again = setup(replayProvider([fixture("valid")]));
    await again.run();
    // Same system prompt and catalogue: the same hash, so a cache miss can't be blamed on the prefix.
    expect(again.meter.records[0]?.prefixHash).toBe(meter.records[0]?.prefixHash);

    const changed = { ...route, cachedContext: "catalogue, with one more part" };
    const third = memoryMeter();
    await callStructured(changed, SpecTurn, messages, {
      provider: replayProvider([fixture("valid")]),
      model: "claude-opus-5",
      meter: third,
      attribution,
    });
    expect(third.records[0]?.prefixHash).not.toBe(meter.records[0]?.prefixHash);
  });

  it("failures carry a sanitized diagnostic, never the rejected text", async () => {
    const invalid = await setup(replayProvider([fixture("invalid-json"), fixture("invalid-json")])).run();
    expect(invalid).toEqual({ ok: false, failure: "invalid_output", calls: 2, diagnostic: { reason: "invalid_json" } });

    const mismatch = await setup(replayProvider([fixture("schema-mismatch"), fixture("schema-mismatch")])).run();
    expect(mismatch).toMatchObject({ ok: false, failure: "invalid_output", diagnostic: { reason: "schema_mismatch" } });
    const diagnostic = (mismatch as { diagnostic: CallDiagnostic }).diagnostic;
    expect(diagnostic.paths).toContain("spec_patch.connect.transport");
    expect(diagnostic.codes?.length).toBeGreaterThan(0);
    // The rejected value itself never leaves the exchange with the model.
    expect(JSON.stringify(diagnostic)).not.toContain("zigbee");

    const provider: LlmProvider = {
      name: "anthropic",
      create: async () => {
        throw Object.assign(new Error("529 overloaded: keep my fridge cold"), { name: "InternalServerError", status: 529, request_id: "req_9" });
      },
    };
    expect(await setup(provider).run()).toEqual({
      ok: false,
      failure: "provider_error",
      calls: 0,
      diagnostic: { reason: "provider_error", errorName: "InternalServerError", status: 529, requestId: "req_9" },
    });
  });

  it("a failed meter insert doesn't lose the turn", async () => {
    const errors: unknown[] = [];
    const provider = replayProvider([fixture("valid")]);
    const result = await callStructured(route, SpecTurn, messages, {
      provider,
      model: "claude-opus-5",
      attribution,
      meter: {
        record: async () => {
          throw new Error("insert failed");
        },
      },
      onMeterError: (error) => errors.push(error),
    });
    expect(result.ok).toBe(true);
    expect(errors).toHaveLength(1);
  });
});
