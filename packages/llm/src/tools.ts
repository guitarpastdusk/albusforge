import type Anthropic from "@anthropic-ai/sdk";
import { FALLBACK_BETA, systemBlocks } from "./request";
import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse, LlmRoute } from "./types";

export type ToolDefinition = Anthropic.Beta.Messages.BetaTool;
export type ToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;
export type ToolResultBlock = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/**
 * Runs one tool. `input` is whatever the model produced: `strict: true` on the
 * definition means it validated against our schema, but an executor still
 * parses it before use — the schema bounds shape, not meaning.
 *
 * Scope (tenant, device) is closed over by the caller and is never a parameter
 * the model can supply. A model cannot name a tenant, so it cannot reach one.
 */
export type ToolExecutor = (input: unknown, signal: AbortSignal) => Promise<{ result: unknown; note?: unknown }>;

export interface ToolLoopOptions {
  provider: LlmProvider;
  model: string;
  route: LlmRoute;
  tools: ToolDefinition[];
  executors: Record<string, ToolExecutor>;
  messages: LlmMessage[];
  /** Model calls, not tool calls. A turn that keeps asking is stopped, not served. */
  maxIterations: number;
  maxTokens: number;
  signal: AbortSignal;
  /** Called for every response, before tools run: meter here. */
  onResponse?: (response: LlmResponse) => void;
  /** Called after each executor returns, with whatever `note` it reported. */
  onToolCall?: (name: string, note: unknown) => void;
}

export type ToolLoopOutcome =
  | { ok: true; text: string; toolCalls: number; iterations: number }
  /**
   * `max_iterations` the model never stopped asking; `refusal` the chain declined;
   * `max_tokens` truncated; `no_text` it ended without prose; `provider_error`
   * transport or deadline. Callers answer deterministically; none of them
   * forwards model text.
   */
  | { ok: false; failure: "max_iterations" | "refusal" | "max_tokens" | "no_text" | "provider_error"; toolCalls: number; iterations: number };

/** One tool-use request. Mirrors `buildRequest`, minus the structured-output format. */
export function buildToolRequest(
  route: LlmRoute,
  { model, maxTokens, tools, messages }: { model: string; maxTokens: number; tools: ToolDefinition[]; messages: LlmMessage[] },
): LlmRequest {
  return {
    model,
    max_tokens: maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: route.effort },
    system: systemBlocks(route),
    tools,
    messages,
  };
}

function textOf(response: LlmResponse): string {
  return response.content
    .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * The request → execute → re-send cycle, written out rather than delegated to
 * the SDK's tool runner: this service needs the per-iteration seam to meter
 * every response, record which queries actually ran, and stop on its own
 * deadline. Thinking blocks are echoed back unchanged with the rest of the
 * assistant turn, which is what continuing on the same model requires.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopOutcome> {
  const messages = [...options.messages];
  let toolCalls = 0;

  for (let iteration = 1; iteration <= options.maxIterations; iteration++) {
    options.signal.throwIfAborted();
    let response: LlmResponse;
    try {
      response = await options.provider.create(
        buildToolRequest(options.route, { model: options.model, maxTokens: options.maxTokens, tools: options.tools, messages }),
        { signal: options.signal },
      );
    } catch {
      return { ok: false, failure: "provider_error", toolCalls, iterations: iteration };
    }
    options.onResponse?.(response);

    if (response.stop_reason === "refusal") return { ok: false, failure: "refusal", toolCalls, iterations: iteration };
    if (response.stop_reason === "max_tokens") return { ok: false, failure: "max_tokens", toolCalls, iterations: iteration };

    if (response.stop_reason === "tool_use") {
      const uses = response.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
      messages.push({ role: "assistant", content: response.content });
      // Parallel calls arrive in one turn and their results must go back in one
      // user message; splitting them teaches the model to stop batching.
      const results: ToolResultBlock[] = [];
      for (const use of uses) {
        toolCalls++;
        const executor = options.executors[use.name];
        if (!executor) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: JSON.stringify({ error: "unknown_tool" }) });
          continue;
        }
        try {
          const { result, note } = await executor(use.input, options.signal);
          options.onToolCall?.(use.name, note);
          results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result) });
        } catch (error) {
          if (options.signal.aborted) throw error;
          // The model is told the call failed and may try a different window.
          // The reason is our own closed vocabulary, never a raw error message.
          const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "failed";
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: JSON.stringify({ error: code }) });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = textOf(response);
    return text ? { ok: true, text, toolCalls, iterations: iteration } : { ok: false, failure: "no_text", toolCalls, iterations: iteration };
  }
  return { ok: false, failure: "max_iterations", toolCalls, iterations: options.maxIterations };
}
