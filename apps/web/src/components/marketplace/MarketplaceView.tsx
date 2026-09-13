import type { Listing, ListingCategory } from "@albusforge/schema";
import Link from "next/link";
import { ButtonLink, PageTitle } from "@/components/ui";
import { cx } from "@/lib/cx";
import { MARKETPLACE_FILTERS, marketplaceHref } from "./filter";
import { ListingCard } from "./ListingCard";

/**
 * Header, category pills and one page of builds. Gateway filters by category
 * before paging, and the pills navigate, so a category is complete across
 * pages. "No builds" is said only when gateway reports no further page.
 */
export function MarketplaceView({
  listings,
  category,
  cursor,
  nextCursor,
}: {
  listings: Listing[];
  category: ListingCategory | null;
  cursor: string | null;
  nextCursor: string | null;
}) {
  return (
    <>
      <PageTitle
        kicker="Community builds"
        title="Marketplace"
        description="Clone a proven build into your workspace — parts, firmware, enclosure and cloud config included."
        actions={
          <nav aria-label="Filter by category" className="flex flex-wrap gap-2">
            {MARKETPLACE_FILTERS.map((filter) => {
              const active = filter.category === category;
              return (
                <Link
                  key={filter.label}
                  href={marketplaceHref({ category: filter.category })}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "rounded-full border px-[18px] py-2 text-[14px]",
                    active ? "border-ink bg-ink text-white hover:text-white" : "border-hairline bg-white text-muted hover:text-ink",
                  )}
                >
                  {filter.label}
                </Link>
              );
            })}
          </nav>
        }
      />

      {listings.length > 0 ? (
        <ul className="mt-9 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[22px]">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </ul>
      ) : null}

      {listings.length === 0 && !nextCursor ? (
        <p className="mt-9 text-[16px] font-light text-muted">
          {cursor ? "No more builds here." : "No builds in this category yet."}
        </p>
      ) : null}

      {nextCursor || cursor ? (
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          {cursor ? (
            <Link href={marketplaceHref({ category })} className="text-[15px] text-muted hover:text-coral-deep">
              ← First page
            </Link>
          ) : null}
          {nextCursor ? (
            <ButtonLink href={marketplaceHref({ category, cursor: nextCursor })} variant="dark" pill className="px-6 py-[11px] text-[15px] font-medium">
              More builds →
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
