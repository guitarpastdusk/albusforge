import type { Listing, ListingCategory } from "@albusforge/schema";

export const CATEGORY_LABEL: Record<ListingCategory, string> = {
  garden: "Garden",
  home: "Home",
  workshop: "Workshop",
  industrial: "Industrial",
};

export const MARKETPLACE_FILTERS: Array<{ label: string; category: ListingCategory | null }> = [
  { label: "All", category: null },
  ...(Object.keys(CATEGORY_LABEL) as ListingCategory[]).map((category) => ({ label: CATEGORY_LABEL[category], category })),
];

export function filterListings(listings: readonly Listing[], category: ListingCategory | null): Listing[] {
  return category ? listings.filter((listing) => listing.category === category) : [...listings];
}
