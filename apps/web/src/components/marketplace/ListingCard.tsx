import type { Listing } from "@albusforge/schema";
import Link from "next/link";
import { accentClasses } from "@/lib/accent";
import { cx } from "@/lib/cx";
import { CATEGORY_LABEL } from "./filter";

export function ListingCard({ listing }: { listing: Listing }) {
  const { bg, fg } = accentClasses[listing.accent];
  return (
    <li className="flex flex-col overflow-hidden rounded-[24px] border border-hairline bg-white transition-shadow hover:shadow-card">
      <div className={cx("px-7 pt-[26px] pb-[22px]", bg)}>
        <span className={cx("rounded-full bg-white/70 px-3.5 py-1.5 text-[13px] font-semibold uppercase tracking-[0.05em]", fg)}>
          {CATEGORY_LABEL[listing.category]}
        </span>
        <h2 className={cx("mt-3.5 font-display text-[25px] font-medium leading-[1.2]", fg)}>{listing.name}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-7 pt-5 pb-6">
        <p className="flex-1 text-[15px] font-light leading-[1.45] text-muted">{listing.description}</p>
        <div className="flex items-center justify-between border-t border-hairline pt-3.5 text-[14px]">
          <span className="text-muted">
            by {listing.author.handle} · {listing.remix_count} clones
          </span>
          {/* TODO(M7): "Clone build" is POST /v1/listings/:id/remix after sign-in; for now it opens the listing. */}
          <Link href={`/marketplace/${encodeURIComponent(listing.id)}`} className="font-semibold text-coral-deep hover:text-coral">
            Clone build →
          </Link>
        </div>
      </div>
    </li>
  );
}
