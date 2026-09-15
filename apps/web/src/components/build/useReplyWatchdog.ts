"use client";

import { useEffect, useEffectEvent, useRef } from "react";

/**
 * A reply usually lands well within 30 s (ASK-TO-ENCLOSURE.md §3 allows ~45 s
 * at the outside). Past this it is late enough to chase, which is sooner than
 * a dead stream would otherwise show itself; a slow reply that does land still
 * merges by id.
 */
export const REPLY_CHECK_AFTER_MS = 30_000;

/**
 * How long to keep chasing before telling the person. Each wait is longer than
 * the last: a turn that failed transiently is answered by the first check,
 * and one that is properly stuck isn't helped by asking faster.
 *
 * Every check is a refetch, never a resend — gateway starts a fresh turn when
 * it sees an unanswered message, so the retry is its business, not ours, and
 * nothing the person wrote is ever sent twice.
 */
export const REPLY_RETRY_AFTER_MS = [REPLY_CHECK_AFTER_MS, 30_000, 60_000] as const;

/**
 * Chases a reply that hasn't arrived.
 *
 * `onCheck` runs at each interval in turn; when they are spent, `onGiveUp`
 * runs once and the chasing stops — a banner that keeps promising to try
 * again while nothing changes is worse than one that says so plainly.
 *
 * The clock starts when `waiting` becomes true and resets when it turns false,
 * so an arriving reply silently ends the sequence.
 */
export function useReplyWatchdog(
  waiting: boolean,
  onCheck: (attempt: number) => void,
  onGiveUp: () => void,
  waits: readonly number[] = REPLY_RETRY_AFTER_MS,
): void {
  const check = useEffectEvent(onCheck);
  const giveUp = useEffectEvent(onGiveUp);
  const attempt = useRef(0);

  useEffect(() => {
    if (!waiting) {
      attempt.current = 0;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      const wait = waits[attempt.current];
      if (wait === undefined) {
        giveUp();
        return;
      }
      timer = setTimeout(() => {
        attempt.current += 1;
        check(attempt.current);
        schedule();
      }, wait);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [waiting, waits]);
}
