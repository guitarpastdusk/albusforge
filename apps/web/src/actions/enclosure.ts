"use server";

import { Id } from "@albusforge/schema";
import type { EnclosurePreviewData } from "@/components/enclosure/fixture";
import { actionFailure } from "@/lib/action-errors";
import type { ActionResult } from "@/lib/action-result";
import { ApiRequestError } from "@/lib/api/core";
import { sessionClient } from "@/lib/api/server";
import { BuildBody, previewOfBody } from "@/lib/enclosure-body";

const READ_TIMEOUT_MS = 10_000;

/**
 * GET /v1/builds/:id/body: the build's own enclosure preview, or null when
 * there is none yet. Null covers gateway's 501 (the route isn't built) and a
 * 404 (no body for this build); the device-ready card keeps its labelled
 * sample for either (docs/DEMO-ASSUMPTIONS.md). Any other failure is logged
 * and reported, so a broken route never passes as "no body".
 */
export async function loadEnclosureBody(buildId: unknown): Promise<ActionResult<EnclosurePreviewData | null>> {
  try {
    const id = Id.safeParse(buildId);
    if (!id.success) return { ok: false, message: "Reload the page to see the enclosure." };

    const client = await sessionClient();
    const body = await client.get(`/v1/builds/${encodeURIComponent(id.data)}/body`, BuildBody, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    return { ok: true, data: previewOfBody(body) };
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 501 || error.status === 404)) return { ok: true, data: null };
    return actionFailure("loadEnclosureBody", error, "We couldn’t load the enclosure preview.");
  }
}
