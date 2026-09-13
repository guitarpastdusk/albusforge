import type { ScopeCategory } from "./policy";

/**
 * Replies code writes without the model. The model's own replies come from
 * SpecTurn.reply; these cover refusals, limits and every failure path, so a
 * person always gets exactly one assistant message per message they send.
 */

const OUT_OF_SCOPE_REASON: Record<ScopeCategory, string> = {
  weapons_harm: "devices meant to hurt people or animals",
  mains_voltage: "anything wired to mains electricity",
  medical_monitoring: "devices that monitor or diagnose medical conditions",
  covert_tracking: "devices that track or record people without their knowledge",
};

export function outOfScopeReply(category: ScopeCategory): string {
  return `Sorry, that's outside what Albus Forge builds: we don't make ${OUT_OF_SCOPE_REASON[category]}. If there's another way to approach what you need, tell me and I'll take a look.`;
}

export const REFUSAL_REPLY =
  "Sorry, that's outside what Albus Forge can help design. If there's a different device you have in mind, tell me about it.";

/** Every failure that isn't the person's doing: invalid output, truncation, deadline, API errors. */
export const FALLBACK_REPLY = "Sorry, could you say that another way?";

export const TOKEN_CEILING_REPLY =
  "This design conversation has reached its length limit, so I can't take more changes here. Start a new build to keep going.";

export const QUESTIONS_INTRO_ONE = "Thanks. One thing changes which parts I'd pick:";
export const QUESTIONS_INTRO_MANY = "Thanks. A few things change which parts I'd pick:";

export function questionsReply(questions: readonly { question: string }[]): string {
  const intro = questions.length === 1 ? QUESTIONS_INTRO_ONE : QUESTIONS_INTRO_MANY;
  return `${intro}\n${questions.map((q) => `- ${q.question}`).join("\n")}`;
}

export function settledReply(assumptions: readonly string[]): string {
  const shown = assumptions.slice(-5);
  const list = shown.length > 0 ? `\n\nI'm going with these defaults, and you can change any of them:\n${shown.map((a) => `- ${a}`).join("\n")}` : "";
  return `That's everything I need to pick parts.${list}`;
}

export const NEEDS_MORE_REPLY = "Tell me a bit more about what the device should sense or do, and I'll take it from there.";
