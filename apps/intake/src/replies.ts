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

/** What Albus Forge does, said once. Every closing reply ends on it. */
const WHAT_WE_BUILD = "Albus Forge designs small connected devices that sense something and tell you about it.";

export function outOfScopeReply(category: ScopeCategory): string {
  return `Sorry — Albus Forge doesn't make ${OUT_OF_SCOPE_REASON[category]}, so this isn't something I can design. ${WHAT_WE_BUILD} If that's what you're after, describe the device and I'll start there.`;
}

export const REFUSAL_REPLY = `Sorry — that isn't something I can design. ${WHAT_WE_BUILD} If that's what you're after, describe the device and I'll start there.`;

/**
 * A message that isn't about building a device. The first one redirects; a
 * second in a row stops, because repeating the redirect reads as an invitation
 * to keep trying.
 */
export function offTopicReply(again: boolean): string {
  return again
    ? `I can't help with that one either — designing a device is all I do here. ${WHAT_WE_BUILD} I'll be here when you have one in mind.`
    : `That's not something I can help with — I only design devices. ${WHAT_WE_BUILD} Tell me what you'd like one to do and we'll get started.`;
}

/**
 * Every failure that isn't the person's doing: invalid output, truncation,
 * deadline, and an API error the caller has no retry left for.
 *
 * So it must not ask them to rephrase. Their message was fine, rephrasing
 * changes nothing, and inviting them to try a different wording sends them
 * round the same loop believing it was their fault. Say whose fault it was,
 * say what happens next, and leave it there.
 */
export const FALLBACK_REPLY =
  "Something went wrong on my end, so I couldn't get to that — nothing to do with what you wrote. Send it again in a moment and it should go through.";

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
