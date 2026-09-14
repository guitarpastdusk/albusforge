import { z } from "zod";
import type { EnclosurePreviewData } from "@/components/enclosure/fixture";

/*
 * GET /v1/builds/:id/body, as the portal reads it. The response type is
 * documented (ASK-TO-ENCLOSURE.md §5–6: signed STL/STEP URLs, GLB and PNG
 * references) but not in @albusforge/schema yet, so this is the portal's
 * reading of it: the fields the viewer needs, everything else passed through.
 * Move it into the schema package when gateway builds the route.
 */
export const BuildBody = z.looseObject({
  /** The viewer model: a GLB with nodes `base`, `lid` and optional `parts`. */
  glb_url: z.url(),
  /** The still image without WebGL. */
  png_url: z.url(),
  /** "90 × 60 × 35 mm · 1.6 mm wall". */
  dimensions_label: z.string().min(1),
  /** The accessible description of the model. */
  description: z.string().min(1),
});
export type BuildBody = z.infer<typeof BuildBody>;

/** The body as the viewer wants it: the build's own enclosure, not a sample. */
export function previewOfBody(body: BuildBody): EnclosurePreviewData {
  return { glbUrl: body.glb_url, staticImageUrl: body.png_url, dimensionsLabel: body.dimensions_label, description: body.description };
}
