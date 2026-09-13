# Workspace usage — API and UI

The `/usage` page now consumes an implemented gateway `GET /v1/usage`, using `UsageSummary` from `packages/schema`. Account controls link to Usage on desktop and mobile. This is recorded consumption visibility, not checkout or billing.

## Data and authorization

The endpoint uses the existing opaque-session/current-membership helper in a read-only repeatable-read transaction. The active tenant scopes every SQL query; public tenant-host selection follows the helper's existing rules. Client tenant, period and date filters are rejected. Missing/revoked/expired sessions return 401 and removed membership returns 403. All responses, including errors, are private/no-store. No new connection pool, database migration, background job or external dependency is added.

The period is the calendar month in UTC at transaction start, with an exclusive next-month boundary. `builds.llm_calls` supplies saved calls, uncached input/output tokens, cache read/creation tokens and recorded `cost_usd`. Costs are summed using PostgreSQL numeric arithmetic; the API returns decimal strings with six fractional digits. Counts are decimal strings and the UI formats them with BigInt, avoiding precision loss above JavaScript's safe-integer limit. Neither client nor endpoint re-prices model calls.

Calls are grouped into actual known stages (`intake`, `codegen`, `bodygen`, `narration`, `ask`, `explain`). Any other stage is included under `other`, so response size stays bounded without dropping unrecognized work. Intake is displayed as Build conversation; it is not mislabeled as tier-2 narration or tier-3 Ask. Cache counters remain separate from uncached input. The total counts saved records, not failed/unrecorded provider attempts or a provider invoice. Unclaimed anonymous calls are excluded; the existing sign-up transaction makes claimed records visible under their tenant. Model attribution remains after deleting a build.

Sensor totals sum `telemetry.usage` for the month through tenant-owned devices. Retries already deduplicate at ingestion. Backfills count in their upload month. `payload_bytes` means accepted canonical JSON payload bytes, not compressed network traffic or physical database storage. Deleting a device cascades its usage rows, so this is consumption for devices still owned by the workspace, not an immutable billing ledger. The page states this limitation explicitly.

`Usage`/`TierUsage` remain exported for the older prototype mock contract; the implemented route and current page use `UsageSummary`. Local mock payloads contain both shapes so older mock tests continue to parse. Cloud Run still rejects mock mode. Plan allowances, subscription charges, storage sizes and billing history remain unavailable rather than being fabricated.

## UI and validation

The page includes current-period cards, a stage table with row/column headers and a keyboard-focusable horizontal overflow region, first-use guidance, workspace identity and snapshot time. Six-digit fractional costs and large integers remain exact. The last included day is shown for the exclusive period end. Parent session failures and route errors continue through the existing guarded-page/error handling.

PostgreSQL tests cover zero/current-month totals, inclusive start/exclusive end, stage/cache/cost accounting, tenant isolation despite multiple memberships, spoofed filters/headers, session revocation/membership removal, real anonymous claim, deletion semantics and failure cleanup. UI tests cover exact formatting, stage labels, cache fields, payload/storage distinction, table semantics, zero-state navigation and year-end display.

Production gates remain real browser/auth deployment verification, representative query-load testing and future reconciliation with a durable billing ledger. Tenant-subdomain SSR handoff must be unified across gateway routes before claiming complete subdomain operation; this endpoint uses the same boundary as the telemetry read API. No deployment or cloud job is dispatched by this PR.
