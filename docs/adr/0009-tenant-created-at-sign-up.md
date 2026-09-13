# 0009 — A tenant is created at sign-up; builds, orders and devices belong to it

**Status:** Proposed, 2026-09-13

## Context

ARCHITECTURE.md §18.1 leaves open whether data hangs off the build or off a tenant. CLOUD-PLATFORM.md §12 recommends **tenant, derived from `h(order)`, added in M1**, because every cloud surface it specifies is tenant-scoped.

The portal design adds a constraint that recommendation doesn't meet: **the Projects screen lists builds that have no order yet** ("Designing", "Parts picked"). If a tenant only comes into existence at checkout, those builds have nowhere to live. And checkout already requires a session (PORTAL.md §5), so by the time an order exists its build already belongs to a signed-in user. The order has nothing to add to tenant identity.

## Decision

### Ownership

- **Every verified user gets a personal tenant on first sign-in**, with the user as `admin` in `tenant_members`. Roles stay `admin | operator | viewer` (CLOUD-PLATFORM.md §5.2). A tenant always has at least one admin.
- **`tenant_id` is required on claimed builds, and on every order and device.** Orders and device identities take `tenant_id` from their build. At checkout, fulfillment reads `build.tenant_id`; it does not derive one. `POST /v1/devices/claim` takes the tenant from the session and requires it to match the build's tenant.
- **Anonymous builds** have `tenant_id` null and an `anon_owner_hash` until claimed (PORTAL.md §5). `builds` carries `CHECK (tenant_id IS NOT NULL OR anon_owner_hash IS NOT NULL)`.
- **Team tenants** use the same tables: another tenant with more members. Nothing about a personal tenant is special-cased except its default name.

### Resolving the tenant for a request

**The host selects a tenant; membership authorizes it.** Gateway resolves exactly one tenant per request and passes it to every query as a bound parameter:

The **request host** is the `Host` header, or the verified `X-Albus-Original-Host` on an internal SSR request whose `X-Albus-Internal-Auth` ID token passes gateway's check ([0007](0007-portal-routing.md), PORTAL.md §1). On any other request the forwarded header is ignored.

1. **Tenant subdomain.** The slug in the request host selects the tenant. Gateway then checks that the session user is in `tenant_members` for that tenant. If not, `/v1` returns `403` and web redirects to the apex. An unknown slug is `404`. The Host header never grants access by itself.
2. **Apex.** The tenant is the session's `active_tenant_id`. It is set to the personal tenant at first sign-in and changed with `PUT /v1/me/active-tenant { tenant_id }`, which checks membership. The portal shows a tenant switcher only to users in more than one tenant.

Role checks for each route run after this, against the resolved tenant.

### Claiming and metering anonymous work

- **`POST /v1/auth/verify` claims anonymous builds into the tenant resolved for that request.** On a first sign-up that is the new personal tenant. For a user who is already signed in, it is the active tenant.
- **Intake and codegen spend LLM tokens before a tenant exists.** `llm_calls` and `usage_records` allow a null `tenant_id` when `anon_owner_hash` is set. The claim transaction re-attributes those rows to the tenant together with the builds.
- **Unclaimed anonymous builds expire after 30 days**, removed by a scheduled job. Their usage stays as platform cost.

### Sessions across hosts

Cookies are host-only ([0007](0007-portal-routing.md)), so there is one session per host. A session created by the apex → subdomain sign-in handoff records `parent_session_id`. **Signing out on any host revokes the whole session family.**

### Slugs

Slugs are optional. A personal tenant is served on the apex. A slug, and a subdomain under [0007](0007-portal-routing.md), is assigned when a tenant asks for one, and can't be a reserved name (`staging`, `app`, `api`, `www`, `ingest`).

Lands in **M1**, with `tenants`, `tenant_members` and the `tenant_id` columns CLOUD-PLATFORM.md §11 already lists.

## Consequences

- `h(order)` is no longer a tenant identifier anywhere. Order-time provisioning (CLOUD-PLATFORM.md §4.2) is unchanged except that it reads the tenant from the build.
- `sessions` ([0008](0008-sign-in-by-email-code.md)) gains `active_tenant_id` and `parent_session_id`.
- A membership check runs on every tenant-scoped request. It should be one indexed lookup, cached for the life of the request.
- Moving a build between tenants (for example, a person joining a team) is an explicit operation with an audit-log entry, not a side effect.
- The expiry job is added as a Cloud Scheduler job alongside the M1/M2 jobs.
- No infrastructure change: the wildcard certificate and host routing already cover optional slugs.
- Resolves the "Tenant or build as the root" row in ARCHITECTURE.md §18.1 once accepted.
