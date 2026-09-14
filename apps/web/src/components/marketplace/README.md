# src/components/marketplace/

- `MarketplaceView` — the page header, the All / Garden / Home / Workshop / Industrial pills and one page of build cards. The pills are links (`?category=`); the page asks gateway for `GET /v1/listings?tags=<category>&cursor=<cursor>`, so filtering happens before paging and a category is complete across pages. "More builds →" follows `next_cursor`; "No builds in this category yet." appears only when gateway reports no further page.
- `ExampleBuildDetails` — an example build's listing page: a note that the design is real (registry parts, passing its checks) but the readings, author and clone count are sample data, then the parts with registry prices and the power supply, the wiring, and the readings the build would send.
- `BuildCircuitDiagram` — the wiring as an SVG: the supply and what it puts out, the brain with its input, rail and logic levels, and a block per peripheral unit showing every connector pin, the header pin it lands on, the volts on the power lead and the I2C address on the bus. Power is a solid coral line, ground a hairline, a signal the carousel's dashed wire. Geometry is computed from the wiring (`lib/example-wiring.ts`), so four probes draw four blocks; the viewBox is 1040 wide and scrolls on a narrow screen rather than shrinking.
- `SampleReadingsTable` — the sample readings (`lib/example-readings.ts`): a column per channel with its unit and the part that reads it, a row per sample in UTC, and a caption saying it is sample data.
- `ListingCard` — pastel header with the category pill and name, description (with its price), author and clone count, and "Clone build →" (opens the listing until remix lands).
- `filter.ts` — category labels, the pill list, `marketplaceHref` (page URL) and `listingsQuery` (gateway query).

With `examples` (gateway answers 501 for listings), `MarketplaceView` says "Example builds". Tests in `marketplace.test.tsx` and `ExampleBuildDetails.test.tsx`.
