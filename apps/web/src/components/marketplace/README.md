# src/components/marketplace/

- `MarketplaceView` — the page header, the All / Garden / Home / Workshop / Industrial pills and one page of build cards. The pills are links (`?category=`); the page asks gateway for `GET /v1/listings?tags=<category>&cursor=<cursor>`, so filtering happens before paging and a category is complete across pages. "More builds →" follows `next_cursor`; "No builds in this category yet." appears only when gateway reports no further page.
- `ListingCard` — pastel header with the category pill and name, description (with its price), author and clone count, and "Clone build →" (opens the listing until remix lands).
- `filter.ts` — category labels, the pill list, `marketplaceHref` (page URL) and `listingsQuery` (gateway query).

Tests in `marketplace.test.tsx`.
