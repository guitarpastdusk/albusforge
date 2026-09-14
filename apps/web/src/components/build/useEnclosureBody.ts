"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { EnclosurePreviewData } from "@/components/enclosure/fixture";
import type { ActionResult } from "@/lib/action-result";
import { settle } from "@/lib/safe-action";

export interface EnclosureBodyState {
  /** What the card shows: the build's body, the fallback while there is none yet, or null while a read has failed. */
  preview: EnclosurePreviewData | null;
  /** A read failed (anything but "no body yet"): the card says so and offers `retry` instead of the sample. */
  error: string | null;
  retry: () => void;
}

/**
 * The device-ready card's enclosure: `fallback` (the labelled sample, or
 * null for none) until the build has a body of its own. Once the card is
 * due (`ready` with a build), the body is read once per build; a body
 * replaces the fallback and "none yet" (501 or 404, `data: null`) keeps it.
 * A failed read is never passed off as the sample: the preview is withdrawn,
 * the message is exposed, and `retry` reads again. Nothing is read before
 * the card is due, so the landing hero never requests a body.
 */
export function useEnclosureBody(
  buildId: string | null,
  ready: boolean,
  fallback: EnclosurePreviewData | null,
  load: (buildId: string) => Promise<ActionResult<EnclosurePreviewData | null>>,
): EnclosureBodyState {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ buildId: string; body: EnclosurePreviewData | null; error: string | null } | null>(null);
  const read = useEffectEvent((id: string) => settle(() => load(id)));

  useEffect(() => {
    if (!buildId || !ready) return;
    let cancelled = false;
    void read(buildId).then((outcome) => {
      if (cancelled) return;
      setResult(outcome.ok ? { buildId, body: outcome.data, error: null } : { buildId, body: null, error: outcome.message });
    });
    return () => {
      cancelled = true;
    };
  }, [buildId, ready, attempt]);

  const current = result && result.buildId === buildId ? result : null;
  return {
    preview: current?.error ? null : (current?.body ?? fallback),
    error: current?.error ?? null,
    retry: () => setAttempt((count) => count + 1),
  };
}
