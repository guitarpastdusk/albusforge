import { ListingCategory, ListingList, routes } from "@albusforge/schema";
import type { Metadata } from "next";
import { listingsQuery } from "@/components/marketplace/filter";
import { MarketplaceView } from "@/components/marketplace/MarketplaceView";
import { PageContainer } from "@/components/ui";
import { isNotImplemented } from "@/lib/api/core";
import { apiGet } from "@/lib/api/server";
import { exampleListings } from "@/lib/example-builds";

export const metadata: Metadata = { title: "Marketplace" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Filter in gateway, before paging: GET /v1/listings?tags=<category>&cursor=<cursor>. While gateway answers
 * 501 (listings not built yet), the example builds, filtered and paged the same way. Any other failure
 * still reaches the error boundary.
 */
async function loadListings(category: ListingCategory | null, cursor: string | null): Promise<ListingList & { examples: boolean }> {
  try {
    return { ...(await apiGet(`${routes.listings.list.path()}${listingsQuery({ category, cursor })}`, ListingList)), examples: false };
  } catch (error) {
    if (!isNotImplemented(error)) throw error;
    return { ...exampleListings(category, cursor), examples: true };
  }
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[]; cursor?: string | string[] }>;
}) {
  const params = await searchParams;
  const parsed = ListingCategory.safeParse(first(params.category));
  const category = parsed.success ? parsed.data : null;
  const rawCursor = first(params.cursor);
  const cursor = rawCursor && rawCursor.length <= 200 ? rawCursor : null;

  const { listings, next_cursor, examples } = await loadListings(category, cursor);

  return (
    <PageContainer>
      <MarketplaceView listings={listings} category={category} cursor={cursor} nextCursor={next_cursor} examples={examples} />
    </PageContainer>
  );
}
