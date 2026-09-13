import { z } from "zod";
import { Accent, Id } from "./common";

export const ListingCategory = z.enum(["garden", "home", "workshop", "industrial"]);
export type ListingCategory = z.infer<typeof ListingCategory>;

export const Listing = z.object({
  id: Id,
  name: z.string(),
  category: ListingCategory,
  accent: Accent,
  description: z.string(),
  author: z.object({ handle: z.string() }),
  /** Shown as "clones" in the UI; the API calls the action remix (§7.7). */
  remix_count: z.number().int().nonnegative(),
});
export type Listing = z.infer<typeof Listing>;

export const ListingList = z.object({
  listings: z.array(Listing),
  next_cursor: z.string().nullable(),
});
export type ListingList = z.infer<typeof ListingList>;

export const RemixResponse = z.object({
  new_build_id: Id,
});
export type RemixResponse = z.infer<typeof RemixResponse>;
