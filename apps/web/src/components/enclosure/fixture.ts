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
 * The checked-in fixture (scripts/make-enclosure-fixture.mjs). No build has an
 * enclosure of its own yet: the body endpoint is the M5.5 contract
 * (GET /v1/builds/:id/body, ASK-TO-ENCLOSURE §6) and doesn't exist in gateway
 * or the mocks, so the portal shows this model labelled as a sample and
 * requests nothing (docs/DEMO-ASSUMPTIONS.md).
 */
export const ENCLOSURE_FIXTURE: EnclosurePreviewData = {
  glbUrl: "/enclosure/fixture.glb",
  staticImageUrl: "/enclosure/fixture.png",
  dimensionsLabel: "90 × 60 × 35 mm · 1.6 mm wall",
  description:
    "A rounded sensor enclosure, 90 × 60 × 35 mm with 1.6 mm walls: a base with a cable hole in the floor, and a lid with five vent slots.",
};

/** The stand-in while no body exists: the fixture, said to be a sample. */
export const ENCLOSURE_SAMPLE: EnclosurePreviewData = {
  ...ENCLOSURE_FIXTURE,
  sample: true,
  description: `Sample enclosure. ${ENCLOSURE_FIXTURE.description} The enclosure generated for this build will replace it.`,
};

/**
 * A build's enclosure preview. `body` is what GET /v1/builds/:id/body will
 * answer once it exists; until a caller has one, the labelled sample. The
 * same in mock and live mode: the fixture is nobody's enclosure.
 */
export function enclosurePreviewFor(body: EnclosurePreviewData | null = null): EnclosurePreviewData {
  return body ?? ENCLOSURE_SAMPLE;
}
