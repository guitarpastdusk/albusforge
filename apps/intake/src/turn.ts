import {
  type CallAttribution,
  type CallFailure,
  callStructured,
  type Effort,
  type LlmMessage,
  type LlmProvider,
  type LlmRoute,
  type Meter,
} from "@albusforge/llm";
import { type Spec, SpecTurn } from "@albusforge/schema";
import type { CatalogueCache } from "./catalogue";
import { type Decision, decide, MAX_CLARIFICATION_ROUNDS } from "./decide";
import type { Log } from "./log";
import { screen, type ScopeCategory } from "./policy";
import { EXTRACT_ROUTE_NAME, type Prompts, renderTemplate } from "./prompts";
import { FALLBACK_REPLY, offTopicReply, outOfScopeReply, REFUSAL_REPLY, TOKEN_CEILING_REPLY } from "./replies";

/** One turn without the database: scope filter, catalogue, model call, decision. */

export interface TurnContext {
  provider: LlmProvider;
  model: string;
  effort: Effort;
  meter: Meter;
  catalogue: CatalogueCache;
  prompts: Prompts;
  /** Per-build total tokens (LLM_BUILD_TOKEN_CEILING). */
  tokenCeiling: number;
  tokensUsed: (buildId: string) => Promise<number>;
  log: Log;
}

export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
}

export interface TurnInput {
  buildId: string;
  attribution: CallAttribution;
  /** The build's messages in order; the last is the user message being answered. */
  transcript: readonly TranscriptMessage[];
  previous: Spec | null;
  /** Spec versions so far that asked questions. */
  roundsUsed: number;
  signal: AbortSignal;
}

export type TurnOutcome =
  | { kind: "spec"; decision: Decision }
  | { kind: "reply"; reason: "out_of_scope" | "off_topic" | CallFailure | "error"; reply: string; category?: ScopeCategory };

/** Output limits for a chat turn: adaptive thinking counts against max_tokens. */
export const EXTRACT_MAX_TOKENS = 8000;
export const EXTRACT_RETRY_MAX_TOKENS = 16000;

export function extractRoute(prompts: Prompts, catalogueText: string, effort: Effort): LlmRoute {
  return {
    name: EXTRACT_ROUTE_NAME,
    stage: "intake",
    system: prompts.extract,
    cachedContext: catalogueText,
    effort,
    maxTokens: EXTRACT_MAX_TOKENS,
    retryMaxTokens: EXTRACT_RETRY_MAX_TOKENS,
  };
}

export function renderTurnContext(template: string, previous: Spec | null, roundsUsed: number): string {
  const left = Math.max(0, MAX_CLARIFICATION_ROUNDS - roundsUsed);
  return renderTemplate(template, {
    rounds_used: String(Math.min(roundsUsed, MAX_CLARIFICATION_ROUNDS)),
    max_rounds: String(MAX_CLARIFICATION_ROUNDS),
    round_rule:
      previous?.settled || left === 0
        ? "No rounds are left: ask no questions, and settle with stated assumptions."
        : "You may ask questions this turn if an answer would change the parts.",
    spec_json: JSON.stringify(previous, null, 2),
  });
}

/**
 * The person's words go only into user turns. Turn state goes in a trailing
 * `role: "system"` message: operator-authored, and after the cached prefix.
 */
export function modelMessages(transcript: readonly TranscriptMessage[], turnContext: string): LlmMessage[] {
  const firstUser = transcript.findIndex((m) => m.role === "user");
  const messages: LlmMessage[] = transcript.slice(Math.max(firstUser, 0)).map((m) => ({ role: m.role, content: m.text }));
  messages.push({ role: "system", content: turnContext });
  return messages;
}

/**
 * Whether the reply before this message was already an off-topic one. The
 * transcript is the whole record of the build, so no extra state is needed to
 * tell a first stray message from a second.
 */
function wasOffTopic(transcript: readonly TranscriptMessage[]): boolean {
  const previousReply = transcript.filter((m) => m.role === "assistant").at(-1);
  return previousReply !== undefined && (previousReply.text === offTopicReply(false) || previousReply.text === offTopicReply(true));
}

const FAILURE_REPLY: Record<CallFailure, string> = {
  refusal: REFUSAL_REPLY,
  token_ceiling: TOKEN_CEILING_REPLY,
  max_tokens: FALLBACK_REPLY,
  invalid_output: FALLBACK_REPLY,
  deadline: FALLBACK_REPLY,
  provider_error: FALLBACK_REPLY,
};

export async function runTurn(ctx: TurnContext, input: TurnInput): Promise<TurnOutcome> {
  const latest = input.transcript.at(-1);
  if (!latest || latest.role !== "user") throw new Error("runTurn needs a transcript ending in a user message");

  const scope = screen(latest.text);
  if (scope.outcome === "OUT_OF_SCOPE") {
    return { kind: "reply", reason: "out_of_scope", category: scope.category, reply: outOfScopeReply(scope.category) };
  }

  const catalogue = await ctx.catalogue.get();
  const route = extractRoute(ctx.prompts, catalogue.text, ctx.effort);
  const messages = modelMessages(input.transcript, renderTurnContext(ctx.prompts.turn, input.previous, input.roundsUsed));

  const result = await callStructured(route, SpecTurn, messages, {
    provider: ctx.provider,
    model: ctx.model,
    meter: ctx.meter,
    attribution: input.attribution,
    signal: input.signal,
    tokenCeiling: { limit: ctx.tokenCeiling, used: () => ctx.tokensUsed(input.buildId) },
    onMeterError: (error) =>
      ctx.log("ERROR", "llm call not stored", { error, trace: input.attribution.trace, fields: { buildId: input.buildId } }),
  });

  if (!result.ok) {
    // The failure class and `callStructured`'s sanitized diagnostic only: a
    // rejected model output, and the parse error quoting it, stay in the
    // exchange with the model (ASK-TO-ENCLOSURE §3, private messages).
    ctx.log(result.failure === "provider_error" ? "ERROR" : "WARNING", "turn answered with a fallback", {
      trace: input.attribution.trace,
      fields: { buildId: input.buildId, failure: result.failure, calls: result.calls, ...result.diagnostic },
    });
    return { kind: "reply", reason: result.failure, reply: FAILURE_REPLY[result.failure] };
  }

  // A message that isn't about building a device ends here: code writes the
  // reply, no spec version is written, and the clarification rounds are
  // untouched — an off-topic message can't spend one.
  if (result.value.reply_kind === "off_topic") {
    return { kind: "reply", reason: "off_topic", reply: offTopicReply(wasOffTopic(input.transcript)) };
  }

  const decision = decide({ previous: input.previous, turn: result.value, vocabulary: catalogue.vocabulary, roundsUsed: input.roundsUsed });
  if (decision.droppedCapabilities.length > 0 || decision.droppedFlags.length > 0) {
    ctx.log("WARNING", "spec values not in the registry vocabulary were dropped", {
      trace: input.attribution.trace,
      fields: { buildId: input.buildId, capabilities: decision.droppedCapabilities.length, flags: decision.droppedFlags.length },
    });
  }
  return { kind: "spec", decision };
}
