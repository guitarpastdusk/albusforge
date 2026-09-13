import { ListingCategory, ListingList, routes } from "@albusforge/schema";
import type { Metadata } from "next";
import { MarketplaceBrowser } from "@/components/marketplace/MarketplaceBrowser";
import { PageContainer } from "@/components/ui";
import { apiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "Marketplace" };

export default async function MarketplacePage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const parsed = ListingCategory.safeParse((await searchParams).category);
  // TODO(M7): page through next_cursor once there are more listings than one response holds.
  const { listings } = await apiGet(routes.listings.list.path(), ListingList);

  return (
    <PageContainer>
      <MarketplaceBrowser listings={listings} initialCategory={parsed.success ? parsed.data : null} />
    </PageContainer>
  );
}
