import type { z } from "zod";
import type { Meter } from "./meter";
import { buildRequest, outputFormat } from "./request";
import type { CallAttribution, LlmMessage, LlmProvider, LlmResponse, LlmRoute } from "./types";

/**
 * Why a structured call produced no value. Every one maps to a safe reply in
 * the caller; none of them leaves the caller holding model text.
 *   refusal         the model (and its fallback chain) declined; no retry
 *   max_tokens      truncated twice (or the context window was exceeded)
 *   invalid_output  not valid JSON, or failed the schema, twice
 *   token_ceiling   the build's token budget is spent; no call was made
 *   deadline        the caller's signal aborted
 *   provider_error  the API or network failed after the SDK's own retries
 */
export type CallFailure = "refusal" | "max_tokens" | "invalid_output" | "token_ceiling" | "deadline" | "provider_error";

export type CallResult<T> =
  | { ok: true; value: T; calls: number }
  | { ok: false; failure: CallFailure; calls: number; error?: unknown };

export interface TokenCeiling {
  limit: number;
  /** Tokens the build has used so far (llm_calls). Read before every call. */
  used: () => Promise<number>;
}

export interface CallOptions {
  provider: LlmProvider;
  model: string;
  meter: Meter;
  attribution: CallAttribution;
  /** The turn's deadline. Aborting it cancels the in-flight request. */
  signal?: AbortSignal;
  tokenCeiling?: TokenCeiling;
  /** Storing a metered call failed. The call still proceeds; its log line is already out. */
  onMeterError?: (error: unknown) => void;
}

/** At most one truncation retry plus one repair retry. */
const MAX_CALLS = 3;

const MAX_REPAIR_DETAIL = 1500;

/** The response's text blocks, joined. Fallback and thinking blocks are skipped. */
export function responseText(response: LlmResponse): string {
  return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

type Validation<T> = { ok: true; value: T } | { ok: false; detail: string };

function validate<S extends z.ZodType>(schema: S, text: string): Validation<z.infer<S>> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, detail: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  const detail = result.error.issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`).join("; ");
  return { ok: false, detail: `Schema mismatch: ${detail}` };
}

function repairTurn(text: string, detail: string): LlmMessage[] {
  return [
    // Never empty: the API rejects an empty assistant turn.
    { role: "assistant", content: text.trim() === "" ? "{}" : text },
    {
      role: "user",
      content: `That output was rejected. ${detail.slice(0, MAX_REPAIR_DETAIL)}\nReturn the whole corrected JSON object, matching the schema exactly.`,
    },
  ];
}

const isAbort = (signal: AbortSignal | undefined, error: unknown) =>
  signal?.aborted === true || (error instanceof Error && error.name === "APIUserAbortError");

/**
 * One structured model call, owning every failure path (ASK-TO-ENCLOSURE.md §3):
 *   1. token ceiling, before any call
 *   2. request on the beta API with fallbacks, adaptive thinking, effort and format
 *   3. meter first: usage is logged and stored before the response is read
 *   4. branch on stop_reason: refusal stops; max_tokens retries once, larger
 *   5. JSON.parse + safeParse; one repair retry with the validation error
 * It never throws for a model or API outcome: failures come back as a CallResult.
 */
export async function callStructured<S extends z.ZodType>(
  route: LlmRoute,
  schema: S,
  messages: LlmMessage[],
  options: CallOptions,
): Promise<CallResult<z.infer<S>>> {
  const { provider, model, meter, attribution, signal, tokenCeiling, onMeterError } = options;
  const format = outputFormat(schema);
  let transcript = messages;
  let maxTokens = route.maxTokens;
  let truncationRetried = false;
  let repaired = false;
  let calls = 0;

  while (calls < MAX_CALLS) {
    if (signal?.aborted) return { ok: false, failure: "deadline", calls };
    if (tokenCeiling && (await tokenCeiling.used()) >= tokenCeiling.limit) return { ok: false, failure: "token_ceiling", calls };

    let response: LlmResponse;
    try {
      response = await provider.create(buildRequest(route, { model, maxTokens, format, messages: transcript }), { signal });
    } catch (error) {
      return { ok: false, failure: isAbort(signal, error) ? "deadline" : "provider_error", calls, error };
    }
    calls++;

    try {
      await meter.record(route.stage, response, attribution);
    } catch (error) {
      onMeterError?.(error);
    }

    switch (response.stop_reason) {
      case "refusal":
        return { ok: false, failure: "refusal", calls };
      case "max_tokens":
        if (truncationRetried) return { ok: false, failure: "max_tokens", calls };
        truncationRetried = true;
        maxTokens = Math.max(maxTokens, route.retryMaxTokens);
        continue;
      case "model_context_window_exceeded":
        return { ok: false, failure: "max_tokens", calls };
      default: {
        const text = responseText(response);
        const result = validate(schema, text);
        if (result.ok) return { ok: true, value: result.value, calls };
        if (repaired) return { ok: false, failure: "invalid_output", calls, error: new Error(result.detail) };
        repaired = true;
        transcript = [...messages, ...repairTurn(text, result.detail)];
      }
    }
  }
  return { ok: false, failure: truncationRetried ? "max_tokens" : "invalid_output", calls };
}
