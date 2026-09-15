import { describe, expect, it, vi } from "vitest";
import { buildToolRequest, runToolLoop, type ToolDefinition } from "./tools";
import type { LlmProvider, LlmResponse, LlmRoute } from "./types";

const route: LlmRoute = { name: "t.v1", stage: "test", system: "S", effort: "low", maxTokens: 64, retryMaxTokens: 64 };
const tools: ToolDefinition[] = [
  { name: "read", description: "read", strict: true, input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
];

function response(partial: Partial<LlmResponse>): LlmResponse {
  return { id: "m", type: "message", role: "assistant", model: "claude-sonnet-5", content: [], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }, ...partial } as LlmResponse;
}
const text = (value: string) => response({ content: [{ type: "text", text: value, citations: null }] as LlmResponse["content"] });
const useTool = (id: string, name = "read") =>
  response({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input: {} }] as LlmResponse["content"] });

function provider(responses: LlmResponse[]): LlmProvider & { requests: unknown[] } {
  const requests: unknown[] = [];
  return { name: "anthropic", requests, create: async (request) => { requests.push(request); return responses.shift() ?? text("done"); } };
}

describe("buildToolRequest", () => {
  it("sends the tools, adaptive thinking and the cached system prefix", () => {
    const request = buildToolRequest({ ...route, cachedContext: "CTX" }, { model: "claude-sonnet-5", maxTokens: 100, tools, messages: [{ role: "user", content: "hi" }] });
    expect(request.tools).toBe(tools);
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.system).toEqual([
      { type: "text", text: "S" },
      { type: "text", text: "CTX", cache_control: { type: "ephemeral" } },
    ]);
    // No output format: a tool-use turn ends in prose, not JSON.
    expect(request.output_config).toEqual({ effort: "low" });
  });
});

describe("runToolLoop", () => {
  const base = { model: "claude-sonnet-5", route, tools, maxIterations: 4, maxTokens: 100, signal: new AbortController().signal };

  it("executes a tool, returns its result to the model, and answers from the next turn", async () => {
    const run = vi.fn(async () => ({ result: { count: 3 }, note: "n" }));
    const p = provider([useTool("t1"), text("Three readings.")]);
    const outcome = await runToolLoop({ ...base, provider: p, executors: { read: run }, messages: [{ role: "user", content: "how many?" }] });
    expect(outcome).toMatchObject({ ok: true, text: "Three readings.", toolCalls: 1, iterations: 2 });
    expect(run).toHaveBeenCalledOnce();
    const second = p.requests[1] as { messages: { role: string; content: unknown }[] };
    // assistant turn echoed back verbatim, then one user message carrying the result
    expect(second.messages).toHaveLength(3);
    expect(second.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ count: 3 }) }] });
  });

  it("returns every parallel result in one user message", async () => {
    const parallel = response({ stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "a", name: "read", input: {} }, { type: "tool_use", id: "b", name: "read", input: {} }] as LlmResponse["content"] });
    const p = provider([parallel, text("ok")]);
    const outcome = await runToolLoop({ ...base, provider: p, executors: { read: async () => ({ result: 1 }) }, messages: [{ role: "user", content: "q" }] });
    expect(outcome).toMatchObject({ ok: true, toolCalls: 2 });
    const second = p.requests[1] as { messages: { role: string; content: { tool_use_id: string }[] }[] };
    expect(second.messages[2]!.content.map((block) => block.tool_use_id)).toEqual(["a", "b"]);
  });

  it("tells the model a tool failed, using a closed code and never the thrown message", async () => {
    const p = provider([useTool("t1"), text("I could not read that window.")]);
    const failing = async () => { throw Object.assign(new Error("connection to 10.0.0.2 refused"), { code: "NO_SUCH_CHANNEL" }); };
    const outcome = await runToolLoop({ ...base, provider: p, executors: { read: failing }, messages: [{ role: "user", content: "q" }] });
    expect(outcome.ok).toBe(true);
    const sent = JSON.stringify(p.requests[1]);
    expect(sent).toContain("NO_SUCH_CHANNEL");
    expect(sent).not.toContain("10.0.0.2");
  });

  it("reports an unknown tool to the model rather than throwing", async () => {
    const p = provider([useTool("t1", "delete_everything"), text("I cannot do that.")]);
    const outcome = await runToolLoop({ ...base, provider: p, executors: {}, messages: [{ role: "user", content: "q" }] });
    expect(outcome).toMatchObject({ ok: true, toolCalls: 1 });
    expect(JSON.stringify(p.requests[1])).toContain("unknown_tool");
  });

  it("stops a model that never stops asking", async () => {
    const p = provider([useTool("1"), useTool("2"), useTool("3"), useTool("4"), useTool("5")]);
    const outcome = await runToolLoop({ ...base, maxIterations: 3, provider: p, executors: { read: async () => ({ result: 1 }) }, messages: [{ role: "user", content: "q" }] });
    expect(outcome).toEqual({ ok: false, failure: "max_iterations", toolCalls: 3, iterations: 3 });
  });

  it.each([
    ["refusal", response({ stop_reason: "refusal" })],
    ["max_tokens", response({ stop_reason: "max_tokens" })],
    ["no_text", response({ content: [] })],
  ])("fails closed on %s without inventing a reply", async (failure, only) => {
    const outcome = await runToolLoop({ ...base, provider: provider([only]), executors: {}, messages: [{ role: "user", content: "q" }] });
    expect(outcome).toMatchObject({ ok: false, failure });
  });

  it("reports a provider error rather than surfacing the transport failure", async () => {
    const broken: LlmProvider = { name: "anthropic", create: async () => { throw new Error("ECONNRESET to api.example"); } };
    const outcome = await runToolLoop({ ...base, provider: broken, executors: {}, messages: [{ role: "user", content: "q" }] });
    expect(outcome).toEqual({ ok: false, failure: "provider_error", toolCalls: 0, iterations: 1 });
  });

  it("meters every response, including the tool-use turns", async () => {
    const onResponse = vi.fn();
    await runToolLoop({ ...base, provider: provider([useTool("t1"), text("ok")]), executors: { read: async () => ({ result: 1 }) },
      messages: [{ role: "user", content: "q" }], onResponse });
    expect(onResponse).toHaveBeenCalledTimes(2);
  });

  it("propagates an abort instead of reporting a tool failure", async () => {
    const controller = new AbortController();
    const outcome = runToolLoop({ ...base, signal: controller.signal, provider: provider([useTool("t1"), text("ok")]),
      executors: { read: async () => { controller.abort(); throw new Error("aborted"); } }, messages: [{ role: "user", content: "q" }] });
    await expect(outcome).rejects.toThrow();
  });
});
