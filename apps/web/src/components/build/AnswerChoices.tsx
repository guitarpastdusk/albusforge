"use client";

import { DraftSpec } from "./SpecPanel";

/**
 * One-tap answers for the question intake is waiting on, inside the bubble that
 * asks it.
 *
 * Intake asks one question at a time and, when the answer is a small closed
 * set, offers the answers with it. Tapping one sends it verbatim as the reply,
 * so the transcript reads as though the person typed it.
 *
 * "Continue chatting" is always beside them, and is not an answer: it sends
 * nothing and opens the reply box instead. That is what keeps the buttons from
 * being a cage — a real answer is often "battery, but it's on a windowsill" —
 * and it is why a single option ("Go") is still a choice.
 */
export function AnswerChoices({
  spec,
  disabled,
  onChoose,
  onContinue,
}: {
  spec: Record<string, unknown> | null;
  disabled: boolean;
  onChoose: (answer: string) => void;
  onContinue: () => void;
}) {
  const options = liveOptions(spec);
  if (!options) return null;

  return (
    <div
      className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-hairline pt-3.5"
      role="group"
      aria-label={options.question}
    >
      {options.options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onChoose(option)}
          className="rounded-full border border-hairline bg-porcelain px-[18px] py-2 text-[15px] text-ink transition-colors hover:border-coral hover:bg-white hover:text-coral-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {option}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={onContinue}
        className="px-1.5 py-2 text-[15px] text-muted underline decoration-hairline underline-offset-4 transition-colors hover:text-coral-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        Continue chatting
      </button>
    </div>
  );
}

/** The question intake is waiting on, when it came with answers. */
export function liveOptions(spec: Record<string, unknown> | null): { question: string; options: string[] } | null {
  const parsed = DraftSpec.safeParse(spec);
  if (!parsed.success) return null;
  const question = parsed.data.open_questions.find((q) => (q.options?.length ?? 0) > 0);
  return question?.options ? { question: question.question, options: question.options } : null;
}
