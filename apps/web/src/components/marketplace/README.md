# src/components/marketplace/

- `MarketplaceView` — the page header, the All / Garden / Home / Workshop / Industrial pills and one page of build cards. The pills are links (`?category=`); the page asks gateway for `GET /v1/listings?tags=<category>&cursor=<cursor>`, so filtering happens before paging and a category is complete across pages. "More builds →" follows `next_cursor`; "No builds in this category yet." appears only when gateway reports no further page.
- `ExampleBuildDetails` — an example build's listing page: a note that the design is real (registry parts, passing its checks) but the readings, author and clone count are sample data, then the parts with registry prices and the power supply.
- `ListingCard` — pastel header with the category pill and name, description (with its price), author and clone count, and "Clone build →" (opens the listing until remix lands).
- `filter.ts` — category labels, the pill list, `marketplaceHref` (page URL) and `listingsQuery` (gateway query).

With `examples` (gateway answers 501 for listings), `MarketplaceView` says "Example builds". Tests in `marketplace.test.tsx` and `ExampleBuildDetails.test.tsx`.
