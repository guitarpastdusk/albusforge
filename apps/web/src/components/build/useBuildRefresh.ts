"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { settle } from "@/lib/safe-action";
import type { ConversationActions, ConversationEvent } from "./conversation";

const RETRY_DELAYS_MS = [1_000, 2_000];
const STALE_DETAILS_MESSAGE = "The latest build details aren’t available yet. Please try again.";

/** Detail hydration has its own lifecycle, independent of whether a reply is due. */
export function useBuildRefresh(actions: ConversationActions, dispatch: (event: ConversationEvent) => void) {
  const [request, setRequest] = useState<{ buildId: string; minSpecVersion: number | null } | null>(null);
  const read = useEffectEvent((buildId: string) => settle(() => actions.refreshBuild(buildId)));
  const emit = useEffectEvent(dispatch);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { buildId, minSpecVersion } = request;

    const attempt = async (retry: number) => {
      const result = await read(buildId);
      if (cancelled) return;
      // An observed version is not proof that the detail read contains it.
      if (result.ok && (result.data.specVersion ?? 0) >= (minSpecVersion ?? 0)) {
        emit({ type: "refreshed", transcript: result.data });
        return;
      }
      const delay = RETRY_DELAYS_MS[retry];
      if (delay !== undefined) {
        timer = setTimeout(() => { void attempt(retry + 1); }, delay);
      } else {
        emit({ type: "refreshFailed", message: result.ok ? STALE_DETAILS_MESSAGE : result.message });
      }
    };
    void attempt(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [request]);

  return (buildId: string, minSpecVersion: number | null) => {
    dispatch({ type: "refreshRequested" });
    // A new event supersedes both old retries and any in-flight result.
    setRequest({ buildId, minSpecVersion });
  };
}
