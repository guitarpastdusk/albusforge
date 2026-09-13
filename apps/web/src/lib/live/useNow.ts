"use client";

import { useEffect, useState } from "react";

/**
 * A clock for relative ages ("40s ago") that starts at the server's `now`, so
 * hydration matches the server render, and then ticks. Ages only need to be
 * right to the second, so a 5 s tick is plenty and cheap.
 */
export function useNow(initial: Date, intervalMs = 5000): Date {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
