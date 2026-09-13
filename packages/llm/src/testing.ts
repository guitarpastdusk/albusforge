/*
 * Recorded-response replay for tests. Nothing here talks to the network.
 * Fixtures are BetaMessage JSON as the API returns it; `live-smoke.ts` in
 * apps/intake records new ones with `recordingProvider`.
 */
import type { LlmCallRecord, Meter } from "./meter";
import { toRecord } from "./meter";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

export interface ReplayProvider extends LlmProvider {
  /** Every request made, in order. */
  readonly requests: LlmRequest[];
}

/**
 * Answers requests with the given responses in order. A function entry can
 * inspect the request or wait on the abort signal. Running out is a test bug.
 */
export function replayProvider(
  responses: Array<LlmResponse | ((request: LlmRequest, signal?: AbortSignal) => Promise<LlmResponse>)>,
): ReplayProvider {
  const requests: LlmRequest[] = [];
  const queue = [...responses];
  return {
    name: "anthropic",
    requests,
    async create(request, { signal }) {
      requests.push(structuredClone(request));
      const next = queue.shift();
      if (next === undefined) throw new Error(`replayProvider: no recorded response for request ${requests.length}`);
      return typeof next === "function" ? next(request, signal) : structuredClone(next);
    },
  };
}

/** Wraps a real provider and hands every response to `save`, for recording fixtures. */
export function recordingProvider(inner: LlmProvider, save: (request: LlmRequest, response: LlmResponse) => void): LlmProvider {
  return {
    name: inner.name,
    async create(request, options) {
      const response = await inner.create(request, options);
      save(request, response);
      return response;
    },
  };
}

/** A response that never arrives until the signal aborts, then rejects as the SDK does. */
export function hangingResponse(): (request: LlmRequest, signal?: AbortSignal) => Promise<LlmResponse> {
  return (_request, signal) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" }));
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
    });
}

/** A meter that keeps records in memory and writes log lines to `lines`. */
export function memoryMeter(): Meter & { records: LlmCallRecord[]; lines: string[] } {
  const records: LlmCallRecord[] = [];
  const lines: string[] = [];
  return {
    records,
    lines,
    async record(stage, response, attribution) {
      const record = toRecord(stage, response, attribution);
      records.push(record);
      return record;
    },
  };
}

/** A minimal BetaMessage for tests that don't need a recorded one. */
export function fakeResponse(overrides: Partial<LlmResponse> & { text?: string } = {}): LlmResponse {
  const { text, ...rest } = overrides;
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: text === undefined ? [] : [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      iterations: null,
      fallback_credit: null,
      output_tokens_details: null,
      speed: null,
    },
    ...rest,
  } as LlmResponse;
}
