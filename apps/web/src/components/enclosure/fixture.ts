import type { ApiMode } from "@/lib/runtime-config";

/** What a 3D enclosure preview needs. Serializable, so a Server Component can pass it to the client. */
export interface EnclosurePreviewData {
  /** The viewer model: a GLB with nodes `base`, `lid` and optional `parts` (docs/ASK-TO-ENCLOSURE.md §6). */
  glbUrl: string;
  /** Shown instead of the 3D view without WebGL. */
  staticImageUrl: string;
  dimensionsLabel: string;
  /** The accessible description of the model, and the static image's alt text. */
  description: string;
  /** True when this is a stand-in for the build's own enclosure, which isn't generated yet (docs/DEMO-ASSUMPTIONS.md). */
  sample?: boolean;
}

/**
 * The checked-in fixture (scripts/make-enclosure-fixture.mjs). Mock mode shows
 * it as the build's preview. Live mode has no enclosure yet: the body endpoint
 * is the M5.5 contract (GET /v1/builds/:id/body, ASK-TO-ENCLOSURE §6) and
 * doesn't exist, so the portal shows the same model labelled as a sample and
 * never requests one (docs/DEMO-ASSUMPTIONS.md).
 */
export const ENCLOSURE_FIXTURE: EnclosurePreviewData = {
  glbUrl: "/enclosure/fixture.glb",
  staticImageUrl: "/enclosure/fixture.png",
  dimensionsLabel: "90 × 60 × 35 mm · 1.6 mm wall",
  description:
    "A rounded sensor enclosure, 90 × 60 × 35 mm with 1.6 mm walls: a base with a cable hole in the floor, and a lid with five vent slots.",
};

/** Live mode's stand-in: the fixture, said to be a sample. */
export const ENCLOSURE_SAMPLE: EnclosurePreviewData = {
  ...ENCLOSURE_FIXTURE,
  sample: true,
  description: `Sample enclosure. ${ENCLOSURE_FIXTURE.description} The enclosure generated for this build will replace it.`,
};

export function enclosurePreviewFor(apiMode: ApiMode): EnclosurePreviewData {
  return apiMode === "mock" ? ENCLOSURE_FIXTURE : ENCLOSURE_SAMPLE;
}
