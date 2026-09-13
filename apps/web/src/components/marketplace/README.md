# src/components/marketplace/

- `MarketplaceBrowser` — the page header, the All / Garden / Home / Workshop / Industrial pills and the card grid. Filtering is client-side over the listings the page fetched; the URL keeps `?category=` so a filtered view can be shared or reloaded.
- `ListingCard` — pastel header with the category pill and name, description (with its price), author and clone count, and "Clone build →" (opens the listing until remix lands).
- `filter.ts` — category labels, the pill list and `filterListings`.

Tests in `marketplace.test.tsx`.
