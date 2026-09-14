import { Listing, routes } from "@albusforge/schema";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExampleBuildDetails } from "@/components/marketplace/ExampleBuildDetails";
import { ButtonLink, PageContainer, PageTitle } from "@/components/ui";
import { isNotImplemented } from "@/lib/api/core";
import { apiGet, orNotFound } from "@/lib/api/server";
import { cloneHref } from "@/lib/clone-ask";
import { exampleBuildDetail, exampleListing, type ExampleBuildDetail } from "@/lib/example-builds";

/** Gateway's listing, or, while gateway answers 501 (listings not built yet), the example build with this id. */
async function loadListing(listingId: string): Promise<{ listing: Listing; example: ExampleBuildDetail | null }> {
  try {
    return { listing: await orNotFound(apiGet(routes.listings.get.path(listingId), Listing)), example: null };
  } catch (error) {
    // Anything but a 501, including Next's own not-found, goes on as before.
    if (!isNotImplemented(error)) throw error;
    const listing = exampleListing(listingId);
    const example = exampleBuildDetail(listingId);
    if (!listing || !example) notFound();
    return { listing, example };
  }
}

export default async function ListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  const { listing, example } = await loadListing(listingId);

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
          actions={
            /* Until POST /v1/listings/:id/remix exists, cloning starts a new build from this design (lib/clone-ask.ts). */
            <ButtonLink href={cloneHref(listing)} variant="coral" className="rounded-[14px] px-[26px] py-[13px] text-[16px] font-semibold">
              Clone build →
            </ButtonLink>
          }
        />
      </div>
      {example ? (
        <ExampleBuildDetails detail={example} />
      ) : (
        <p className="mt-8 max-w-[640px] text-[16px] font-light leading-[1.5] text-muted">
          Clone this build to start from its design: the request opens in the build chat, where you can change anything
          before the parts are picked.
        </p>
      )}
    </PageContainer>
  );
}
