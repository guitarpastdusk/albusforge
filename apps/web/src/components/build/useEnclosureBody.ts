"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { EnclosurePreviewData } from "@/components/enclosure/fixture";
import type { ActionResult } from "@/lib/action-result";
import { settle } from "@/lib/safe-action";

/**
 * The device-ready card's enclosure: `fallback` (the labelled sample, or
 * null for none) until the build has a body of its own. Once the card is
 * due (`ready` with a build), the body is read once per build; a body
 * replaces the fallback, "none yet" (501 or 404) keeps it, and a failure
 * keeps it too, logged by the action. Nothing is read before the card is
 * due, so the landing hero never requests a body.
 */
export function useEnclosureBody(
  buildId: string | null,
  ready: boolean,
  fallback: EnclosurePreviewData | null,
  load: (buildId: string) => Promise<ActionResult<EnclosurePreviewData | null>>,
): EnclosurePreviewData | null {
  const [body, setBody] = useState<{ buildId: string; preview: EnclosurePreviewData } | null>(null);
  const read = useEffectEvent((id: string) => settle(() => load(id)));

  useEffect(() => {
    if (!buildId || !ready) return;
    let cancelled = false;
    void read(buildId).then((result) => {
      if (!cancelled && result.ok && result.data) setBody({ buildId, preview: result.data });
    });
    return () => {
      cancelled = true;
    };
  }, [buildId, ready]);

  return body && body.buildId === buildId ? body.preview : fallback;
}
