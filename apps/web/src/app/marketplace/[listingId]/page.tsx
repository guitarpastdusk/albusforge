import { Listing, routes } from "@albusforge/schema";
import Link from "next/link";
import { PageContainer, PageTitle } from "@/components/ui";
import { apiGet, orNotFound } from "@/lib/api/server";

export default async function ListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  const listing = await orNotFound(apiGet(routes.listings.get.path(listingId), Listing));

  return (
    <PageContainer>
      <Link href="/marketplace" className="text-[15px] text-muted hover:text-coral-deep">
        ← Marketplace
      </Link>
      <div className="mt-[18px]">
        <PageTitle
          kicker={`${listing.category} · by ${listing.author.handle} · ${listing.remix_count} clones`}
          title={listing.name}
          description={listing.description}
        />
      </div>
      {/* TODO(M7): snapshot summary, remix tree, reviews; "Clone build" → POST /v1/listings/:id/remix. */}
      <p className="mt-8 text-[16px] font-light text-muted">Stub — the listing page isn’t designed yet.</p>
    </PageContainer>
  );
}
