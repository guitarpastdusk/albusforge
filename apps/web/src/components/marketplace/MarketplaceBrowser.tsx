"use client";

import type { Listing, ListingCategory } from "@albusforge/schema";
import { useState } from "react";
import { PageTitle } from "@/components/ui";
import { cx } from "@/lib/cx";
import { filterListings, MARKETPLACE_FILTERS } from "./filter";
import { ListingCard } from "./ListingCard";

/** Header, category pills and the build grid. Filtering is client-side; the URL keeps ?category= for sharing. */
export function MarketplaceBrowser({
  listings,
  initialCategory,
}: {
  listings: Listing[];
  initialCategory: ListingCategory | null;
}) {
  const [category, setCategory] = useState(initialCategory);
  const visible = filterListings(listings, category);

  const choose = (next: ListingCategory | null) => {
    setCategory(next);
    window.history.replaceState(null, "", next ? `/marketplace?category=${next}` : "/marketplace");
  };

  return (
    <>
      <PageTitle
        kicker="Community builds"
        title="Marketplace"
        description="Clone a proven build into your workspace — parts, firmware, enclosure and cloud config included."
        actions={
          <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
            {MARKETPLACE_FILTERS.map((filter) => {
              const active = filter.category === category;
              return (
                <button
                  key={filter.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => choose(filter.category)}
                  className={cx(
                    "rounded-full border px-[18px] py-2 text-[14px]",
                    active ? "border-ink bg-ink text-white" : "border-hairline bg-white text-muted hover:text-ink",
                  )}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        }
      />

      <ul className="mt-9 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[22px]">
        {visible.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </ul>
      {visible.length === 0 ? <p className="mt-9 text-[16px] font-light text-muted">No builds in this category yet.</p> : null}
    </>
  );
}
