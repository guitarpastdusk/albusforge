import type { ListingCategory } from "@albusforge/schema";

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

interface MarketplacePage {
  category: ListingCategory | null;
  cursor?: string | null;
}

/** The page URL: `/marketplace?category=industrial&cursor=…`. */
export function marketplaceHref({ category, cursor }: MarketplacePage): string {
  const query = new URLSearchParams();
  if (category) query.set("category", category);
  if (cursor) query.set("cursor", cursor);
  const search = query.toString();
  return search ? `/marketplace?${search}` : "/marketplace";
}

/** The gateway query: filtered by gateway, before paging — GET /v1/listings?tags=…&cursor=…. */
export function listingsQuery({ category, cursor }: MarketplacePage): string {
  const query = new URLSearchParams();
  if (category) query.set("tags", category);
  if (cursor) query.set("cursor", cursor);
  const search = query.toString();
  return search ? `?${search}` : "";
}
