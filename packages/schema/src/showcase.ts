import { z } from "zod";
import { Accent, Id, Timestamp } from "./common";

/**
 * One card in the landing carousel. Public and unauthenticated, so it carries
 * only what the owner opted into showing: a name, one formatted reading, and
 * the three-node sensor → brain → output chain.
 */
export const ShowcaseCard = z.object({
  id: Id,
  name: z.string(),
  accent: Accent,
  reading: z.string(),
  chain: z.tuple([z.string(), z.string(), z.string()]),
  caption: z.string(),
  /** Required: the showcase is curated from devices that are reporting. */
  last_reading_at: Timestamp,
});
export type ShowcaseCard = z.infer<typeof ShowcaseCard>;

export const Showcase = z.object({
  cards: z.array(ShowcaseCard),
});
export type Showcase = z.infer<typeof Showcase>;
