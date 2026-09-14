import { describe, expect, it, vi } from "vitest";
import type { LlmProvider, LlmResponse } from "@albusforge/llm";
import type { DeviceConverseRequest } from "@albusforge/schema";
import { contextBlock, converse } from "./converse";
import type { ConverseStore, DeviceContext } from "./converse-store";

const context: DeviceContext = {
  device_id: "11111111-1111-4111-8111-111111111111",
  display_name: "Plant A",
  status: "online",
  last_seen_at: "2026-09-14T12:00:00.000Z",
  next_s: 300,
  revoked: false,
  health: { batt_mv: 3810, rssi: -58, health: ["OK"] },
  channels: [
    { channel: "temperature_c", unit: "C", latest: { t: "2026-09-14T12:00:00.000Z", v: 25.3 } },
    { channel: "humidity_pct", unit: "%", latest: null },
  ],
  raw_before: "2026-06-16T00:00:00.000Z",
  now: "2026-09-14T12:01:00.000Z",
};

const request: DeviceConverseRequest = {
  question: "How warm has it been?",
  history: [],
  request_id: "22222222-2222-4222-8222-222222222222",
  actor_id: "33333333-3333-4333-8333-333333333333",
  tenant_id: "44444444-4444-4444-8444-444444444444",
  device_id: context.device_id,
};

function store(overrides: Partial<ConverseStore> = {}): ConverseStore {
  return {
    context: async () => context,
    window: async (_q, args) => ({ channel: args.channel, unit: "C", from: args.from, to: args.to, count: 12, min: 21, max: 26.4, mean: 24.1,
      latest: { t: "2026-09-14T12:00:00.000Z", v: 25.3 } }),
    series: async (_q, args) => ({ channel: args.channel, unit: "C", resolution: args.resolution, points: [], truncated: false }),
    ...overrides,
  };
}
function response(partial: Partial<LlmResponse>): LlmResponse {
  return { id: "m", type: "message", role: "assistant", model: "claude-sonnet-5", content: [], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 }, ...partial } as LlmResponse;
}
const text = (value: string) => response({ content: [{ type: "text", text: value, citations: null }] as LlmResponse["content"] });
type SentRequest = { messages: { role: string; content: unknown }[]; system: { text: string; cache_control?: unknown }[] };
function provider(responses: LlmResponse[]): LlmProvider & { requests: SentRequest[] } {
  const requests: SentRequest[] = [];
  return { name: "anthropic", requests, create: async (request) => { requests.push(request as unknown as SentRequest); return responses.shift() ?? text("done"); } };
}
const options = (p?: LlmProvider, s = store()) => ({
  store: s, provider: p, model: p ? "claude-sonnet-5" : undefined, maxTokens: 512, maxIterations: 4, write: () => undefined,
});
const signal = () => new AbortController().signal;

describe("contextBlock", () => {
  it("states the retention boundary and the current time, so relative dates resolve", () => {
    const block = contextBlock(context);
    expect(block).toContain("raw readings retained from: 2026-06-16T00:00:00.000Z");
    expect(block).toContain("Current time is 2026-09-14T12:01:00.000Z");
  });

  it("distinguishes a channel with no stored reading from one reading zero", () => {
    expect(contextBlock(context)).toContain("humidity_pct (%) — no reading stored yet");
    expect(contextBlock(context)).toContain("temperature_c (C) — latest 25.3");
  });
});

describe("converse", () => {
  it("returns a deterministic summary, not silence, when no model is configured", async () => {
    const answer = await converse(request, options(undefined), signal());
    expect(answer.mode).toBe("unavailable");
    expect(answer.reply).toContain("temperature_c: 25.3 C");
    expect(answer.reply).toContain("humidity_pct: no reading stored");
    expect(answer.queries).toEqual([]);
  });

  it("answers in the model's words and records the window it read", async () => {
    const toolUse = response({ stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "query_window",
        input: { channel: "temperature_c", from: "2026-09-14T00:00:00.000Z", to: "2026-09-14T12:00:00.000Z" } }] as LlmResponse["content"] });
    const answer = await converse(request, options(provider([toolUse, text("It peaked at 26.4 C today.")])), signal());
    expect(answer.mode).toBe("model");
    expect(answer.reply).toBe("It peaked at 26.4 C today.");
    expect(answer.queries).toEqual([
      { tool: "query_window", channel: "temperature_c", from: "2026-09-14T00:00:00.000Z", to: "2026-09-14T12:00:00.000Z", points: 12 },
    ]);
  });

  it("marks an answer that read nothing, rather than presenting it as evidenced", async () => {
    const answer = await converse(request, options(provider([text("Sensors measure things.")])), signal());
    expect(answer.mode).toBe("no_tool");
    expect(answer.queries).toEqual([]);
  });

  it("falls back to the summary when the model refuses, and forwards no model text", async () => {
    const answer = await converse(request, options(provider([response({ stop_reason: "refusal" })])), signal());
    expect(answer.mode).toBe("unavailable");
    expect(answer.reply).toContain("could not complete that answer");
  });

  const windowCall = (input: Record<string, unknown>) =>
    response({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "query_window", input }] as LlmResponse["content"] });

  it("passes the trusted request to the store, so scope cannot come from the model", async () => {
    const seen: unknown[] = [];
    const scoped = store({ window: async (q, args) => { seen.push(q); return { channel: args.channel, unit: "C", from: args.from, to: args.to,
      count: 1, min: 1, max: 1, mean: 1, latest: null }; } });
    const call = windowCall({ channel: "temperature_c", from: "2026-09-14T00:00:00.000Z", to: "2026-09-14T01:00:00.000Z" });
    await converse(request, options(provider([call, text("ok")]), scoped), signal());
    // The store is handed the request itself; the tool arguments carry only channel and window.
    expect(seen).toEqual([request]);
  });

  it("refuses a tool call that tries to widen its own scope, without reaching the store", async () => {
    const seen: unknown[] = [];
    const scoped = store({ window: async (q, args) => { seen.push(q); return { channel: args.channel, unit: "C", from: args.from, to: args.to,
      count: 1, min: 1, max: 1, mean: 1, latest: null }; } });
    // A hostile argument set. `strict: true` on the definition should stop this
    // upstream; the executor's own strict parse is the second line.
    const call = windowCall({ channel: "temperature_c", from: "2026-09-14T00:00:00.000Z", to: "2026-09-14T01:00:00.000Z",
      tenant_id: "99999999-9999-4999-8999-999999999999" });
    const p = provider([call, text("I could not read that.")]);
    const answer = await converse(request, options(p, scoped), signal());
    expect(seen).toEqual([]);
    expect(answer.queries).toEqual([]);
    expect(JSON.stringify(p.requests[1])).toContain("is_error");
  });

  it("rejects a tool argument that is not a valid channel key, without failing the turn", async () => {
    const toolUse = response({ stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "query_window",
        input: { channel: "../../etc", from: "2026-09-14T00:00:00.000Z", to: "2026-09-14T01:00:00.000Z" } }] as LlmResponse["content"] });
    const p = provider([toolUse, text("I could not read that channel.")]);
    const answer = await converse(request, options(p), signal());
    expect(answer.mode).toBe("model");
    expect(answer.queries).toEqual([]);
    expect(JSON.stringify(p.requests[1])).toContain("is_error");
  });

  it("replays prior turns and appends the new question exactly once", async () => {
    const p = provider([text("ok")]);
    await converse({ ...request, history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] }, options(p), signal());
    expect(p.requests[0]!.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "How warm has it been?" },
    ]);
  });

  it("carries the device's facts as the cached prefix, not in the question", async () => {
    const p = provider([text("ok")]);
    await converse(request, options(p), signal());
    const system = p.requests[0]!.system;
    expect(system.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    expect(system.at(-1)!.text).toContain("Plant A");
  });

  it("meters the call and tags the line with the device and tenant", async () => {
    const write = vi.fn();
    await converse(request, { ...options(provider([text("ok")])), write }, signal());
    const line = JSON.parse(write.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ device_id: request.device_id, tenant_id: request.tenant_id, stage: "device_chat" });
  });
});
