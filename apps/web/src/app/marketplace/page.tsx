import { ListingCategory, ListingList, routes } from "@albusforge/schema";
import type { Metadata } from "next";
import { listingsQuery } from "@/components/marketplace/filter";
import { MarketplaceView } from "@/components/marketplace/MarketplaceView";
import { PageContainer } from "@/components/ui";
import { apiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "Marketplace" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

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

  // Filter in gateway, before paging: GET /v1/listings?tags=<category>&cursor=<cursor>.
  const { listings, next_cursor } = await apiGet(`${routes.listings.list.path()}${listingsQuery({ category, cursor })}`, ListingList);

  return (
    <PageContainer>
      <MarketplaceView listings={listings} category={category} cursor={cursor} nextCursor={next_cursor} />
    </PageContainer>
  );
}
