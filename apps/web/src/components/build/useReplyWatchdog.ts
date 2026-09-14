"use client";

import { useEffect, useEffectEvent } from "react";

/**
 * A reply usually lands well within 30 s (ASK-TO-ENCLOSURE.md §3 allows ~45 s
 * at the outside). Past this, stop the typing dots and offer "Check for a
 * reply": a refetch, never a resend. A viewer facing a dead stream sees the
 * offer sooner; a slow reply that does land still merges by id.
 */
export const REPLY_CHECK_AFTER_MS = 30_000;

/**
 * Calls `onOverdue` once if `waiting` stays true for `afterMs`. The clock
 * starts when `waiting` becomes true and is dropped when it turns false (the
 * reply arrived) or the component unmounts.
 */
export function useReplyWatchdog(waiting: boolean, onOverdue: () => void, afterMs: number = REPLY_CHECK_AFTER_MS): void {
  const overdue = useEffectEvent(onOverdue);

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => overdue(), afterMs);
    return () => clearTimeout(timer);
  }, [waiting, afterMs]);
}
