# M6c — Authenticated telemetry reads

This slice exposes stored telemetry through gateway using the existing direct PostgreSQL pool. Ingestion remains exclusively in standalone cloudlink. It builds on merged PRs #32 and #40; no additional service, database migration, external application or Terraform is required.

## Authentication and tenant boundary

Every endpoint requires `__Host-albus_session`, an opaque random 32-byte token encoded as 43 unpadded base64url characters. Only its SHA-256 hex hash is queried in `users.sessions`. Missing, malformed, duplicate, unknown, expired or revoked tokens return 401. Device bearer credentials and the anonymous build cookie do not grant telemetry access. Ancestor sessions must also be unexpired, unrevoked and owned by the same user.

On the apex, staging apex, localhost or an internal SSR hostname, reads use the session's `active_tenant_id`. A public `<slug>.albusforge.ai` host selects that tenant, as specified by ADR 0009; unknown tenant hosts return 404. Current membership is required in both cases (403 otherwise). Viewer, operator and admin can read. Forwarded host and tenant headers never select a tenant. The frontend's host-only cookie and eventual subdomain handoff remain the authentication issuer's responsibility; internal SSR calls use the active tenant and must not impersonate a tenant host with an untrusted forwarded header.

Authentication, membership checks and data queries share one `REPEATABLE READ READ ONLY` transaction. History requests first acquire `LOCK TABLE ONLY telemetry.readings IN ACCESS SHARE MODE`, before any SELECT establishes the snapshot. Maintenance and the partition helper take ACCESS EXCLUSIVE on that parent before moving/dropping partitions or advancing retention, so a reader sees either the complete earlier layout/watermark or the committed newer one. Acquiring the lock after authentication would be too late: PostgreSQL catalog visibility can otherwise diverge from the older row snapshot ([MVCC caveats](https://www.postgresql.org/docs/16/mvcc-caveats.html), [LOCK ordering](https://www.postgresql.org/docs/16/sql-lock.html)). The shared lock is compatible with normal inserts; pending exclusive maintenance can still delay new requests. Existing statement/query timeouts bound waits (503 on timeout), and maintenance retains its 2s lock timeout/retry contract. Fleet/detail/latest do not take this raw-parent lock. Session expiry and minute-retention date calculations use statement time rather than the potentially earlier transaction start after a lock wait. Revocation/membership changes committed before this snapshot take effect immediately; an already admitted request can finish from its snapshot. Every device/data SQL query binds the resolved tenant ID. An absent device and a device outside that tenant both return 404, even if the user belongs to another tenant. Queries reject `tenant_id` and other undeclared filters. No source snapshot, credential hash or session token appears in a response. All responses, including errors, carry `Cache-Control: private, no-store`.

**This implements session validation, not sign-in issuance.** The existing session/member tables are used without changing their schema. Email-code verification, sign-out/family revocation, tenant switching and subdomain session handoff still need their auth endpoints. Integration tests provision real sessions directly in isolated PostgreSQL; there is no development bypass or public token-minting endpoint. A production dashboard must wait for the issuer/host-routing integration.

## Endpoints

Shared route builders and Zod request/response schemas live in `packages/schema/src/telemetry-read.ts` and `routes.telemetry`.

| GET path | Query | Response |
| --- | --- | --- |
| `/v1/telemetry/devices` | `limit` default 50, max 100; optional `after` UUID | `TelemetryFleetPage`: devices ordered by UUID and `next_after` cursor |
| `/v1/telemetry/devices/:id` | none | `TelemetryDeviceDetail`: state and provisioned channel ranges/units |
| `/v1/telemetry/devices/:id/latest` | none | `TelemetryLatest`: last committed sample per channel, ordered by channel |
| `/v1/telemetry/devices/:id/series` | `channel`, ISO `from`/`to`, `resolution=raw|1m|1h` (default raw), `limit` default 1000, max 2000 | `TelemetryHistory`: ordered samples or SQL aggregates, plus `pending_rollup` |

Device state includes `last_seen_at` (packet arrival, not sample time), `next_s`, `revoked_at`, and the last device health envelope. A device that has never uploaded is `never_seen`. Otherwise it is `online` when its last upload is no more than `max(60, 3 * next_s)` seconds old and its credential is not revoked; other devices are `offline`. This is a request-time display rule, not a persisted offline alert. Historical samples and latest readings remain readable after device credential revocation.

The list has no fabricated build IDs, names, display precision or widgets. The portal's existing `Fleet`/`DeviceDashboard` contracts and routes remain unchanged: they require BuildPlan provisioning and presentation metadata not yet stored by this telemetry slice. These additive endpoints provide the data needed by a future dashboard adapter and typed intelligence tools.

## History semantics and bounds

Windows are half-open: `from <= sample timestamp < to`. Raw requests span at most 24 hours; minute requests at most 7 days; hourly requests at most 366 days. Rollup bounds must align exactly to UTC minute/hour boundaries so a returned bucket never silently includes data outside the requested window. Larger history can be read in successive windows. The requested resolution is never silently changed.

Raw samples preserve timestamp, sequence and ordinal ordering, including multiple readings at the same timestamp and zero values. Sequences/counts are decimal strings to avoid JavaScript integer precision loss. Aggregates expose `v` as the SQL mean (`sum / n`), plus `n`, exact decimal `sum`/`stddev`, `min`, `max` and deterministic `last`. No interpolation or model calculation occurs.

The query fetches at most `limit + 1` rows. If more than `limit` points exist it returns 422 `TOO_MANY_POINTS`; callers must narrow the window, use a coarser resolution, or increase the limit. It never returns a truncated series as if complete. A channel that is not provisioned returns 404; a valid channel with no data returns an empty array.

Raw windows starting behind the storage watermark and minute windows starting before the current UTC-day-minus-7-days retention boundary return 410 `HISTORY_EXPIRED` with `available_from`. This deliberately avoids presenting partial expired history as complete, even when maintenance backlog has temporarily retained extra rows. Hourly data remains readable after raw expiry. Gaps inside retained ranges are gaps, not zeros.

For rollup requests, `pending_rollup=true` means at least one dirty hour overlaps the requested device/channel/window in the same snapshot. Returned aggregates may be stale or absent until the worker processes that hour. Raw responses do not depend on rollup freshness. This is a durable queue check, not an SSE/event implementation.

## Validation and remaining work

Real PostgreSQL tests cover session expiry/revocation/ancestry, membership removal, active-tenant switching, public host selection, spoofed headers, cross-tenant device/list/latest/history isolation, pagination, credential redaction, device states, exact sequence/zero/latest handling, raw ordering and window boundaries, real rollup recomputation/freshness, retention, query limits, failure cleanup/read-only enforcement, and real maintenance overlaps (default-to-daily movement and expired-partition deletion, with reader and maintenance first). Lock-wait timeout and expiry after transaction start are covered. CI also checks the built gateway image rejects unauthenticated telemetry requests without a database and serves a session-bound fixture fleet against migrated PostgreSQL. The gateway's existing pool, connection/query timeouts and redacted error handling apply. There is no new connection pool or background work per request.

Before fleet rollout, measure query plans/latency at representative tenant sizes (especially fleet pagination), tune the shared gateway connection/admission budget, integrate authenticated sign-in/host routing and provision production device/channel snapshots. Derived dashboard screens, SSE reconnect/backfill, offline alerts, and M6.5 detectors/AI tools follow as separate work. No jobs or deployments are dispatched by this change.
