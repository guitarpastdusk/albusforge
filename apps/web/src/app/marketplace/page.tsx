import { ListingCategory, ListingList, routes } from "@albusforge/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer, PageTitle } from "@/components/ui";
import { accentClasses } from "@/lib/accent";
import { apiGet } from "@/lib/api/server";
import { cx } from "@/lib/cx";

export const metadata: Metadata = { title: "Marketplace" };

const FILTERS = [
  { label: "All", category: null },
  ...ListingCategory.options.map((category) => ({
    label: category[0]!.toUpperCase() + category.slice(1),
    category,
  })),
];

export default async function MarketplacePage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const parsed = ListingCategory.safeParse((await searchParams).category);
  const category = parsed.success ? parsed.data : null;

  const query = category ? `?tags=${encodeURIComponent(category)}` : "";
  const { listings } = await apiGet(`${routes.listings.list.path()}${query}`, ListingList);

  return (
    <PageContainer>
      <PageTitle
        kicker="Community builds"
        title="Marketplace"
        description="Clone a proven build into your workspace — parts, firmware, enclosure and cloud config included."
        actions={
          <nav aria-label="Categories" className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => {
              const active = filter.category === category;
              return (
                <Link
                  key={filter.label}
                  href={filter.category ? `/marketplace?category=${filter.category}` : "/marketplace"}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "rounded-full border px-[18px] py-2 text-[14px]",
                    active
                      ? "border-ink bg-ink text-white hover:text-white"
                      : "border-hairline bg-white text-muted hover:text-ink",
                  )}
                >
                  {filter.label}
                </Link>
              );
            })}
          </nav>
        }
      />

      {/* Stub: proves the data path. Clone = POST /v1/listings/:id/remix, after sign-in. */}
      <ul className="mt-9 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[22px]">
        {listings.map((listing) => {
          const { bg, fg } = accentClasses[listing.accent];
          return (
            <li key={listing.id} className="flex flex-col overflow-hidden rounded-[24px] border border-hairline bg-white hover:shadow-card">
              <div className={cx("px-7 pt-[26px] pb-[22px]", bg)}>
                <span className={cx("rounded-full bg-white/70 px-3.5 py-1.5 text-[13px] font-semibold uppercase tracking-[0.05em]", fg)}>
                  {listing.category}
                </span>
                <h2 className={cx("mt-3.5 font-display text-[25px] font-medium leading-[1.2]", fg)}>{listing.name}</h2>
              </div>
              <div className="flex flex-1 flex-col gap-3 px-7 pt-5 pb-6">
                <p className="flex-1 text-[15px] font-light leading-[1.45] text-muted">{listing.description}</p>
                <div className="flex items-center justify-between border-t border-hairline pt-3.5 text-[14px]">
                  <span className="text-muted">
                    by {listing.author.handle} · {listing.remix_count} clones
                  </span>
                  <Link href={`/marketplace/${encodeURIComponent(listing.id)}`} className="font-semibold">
                    Clone build →
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </PageContainer>
  );
}
