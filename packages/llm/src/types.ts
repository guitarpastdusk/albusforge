import type Anthropic from "@anthropic-ai/sdk";

/** SDK types, re-exported so callers never redefine them. */
export type LlmMessage = Anthropic.Beta.Messages.BetaMessageParam;
export type LlmResponse = Anthropic.Beta.Messages.BetaMessage;
export type LlmUsage = Anthropic.Beta.Messages.BetaUsage;
export type LlmRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Trace context for the Cloud Logging trace field. */
export interface TraceContext {
  traceId: string;
  spanId?: string;
  sampled?: boolean;
}

/**
 * One kind of model call: its prompt and limits. `system` and `cachedContext`
 * are the stable prefix, cached up to a breakpoint on `cachedContext` (or on
 * `system` when there is no context). Nothing volatile may go in either.
 */
export interface LlmRoute {
  /** e.g. `intake.extract.v1`; names the prompt file version. */
  name: string;
  /** `llm_calls.stage` and the log line's `stage`. */
  stage: string;
  system: string;
  cachedContext?: string;
  effort: Effort;
  maxTokens: number;
  /** max_tokens for the single retry after a `max_tokens` stop. */
  retryMaxTokens: number;
}

/** Who a call is attributed to (ADR 0009): the build's tenant, or its anonymous owner. */
export interface CallAttribution {
  buildId: string | null;
  tenantId: string | null;
  anonOwnerHash: string | null;
  trace?: TraceContext;
}

export interface LlmProvider {
  readonly name: "anthropic" | "vertex";
  create(request: LlmRequest, options: { signal?: AbortSignal }): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    readonly code: "NOT_IMPLEMENTED" | "CONFIG",
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
