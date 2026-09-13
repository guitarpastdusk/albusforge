# 0009 — A tenant is created at sign-up; builds, orders and devices belong to it

**Status:** Proposed, 2026-09-13

## Context

ARCHITECTURE.md §18.1 leaves open whether data hangs off the build or off a tenant. CLOUD-PLATFORM.md §12 recommends **tenant, derived from `h(order)`, added in M1**, because every cloud surface it specifies is tenant-scoped.

The portal design adds a constraint that recommendation doesn't meet: **the Projects screen lists builds that have no order yet** ("Designing", "Parts picked"). If a tenant only comes into existence at checkout, those builds have nowhere to live, and a user's workspace would be split between order-derived tenants and something else.

## Decision

- **Every verified user gets a personal tenant on first sign-in.** The user is its owner in `tenant_members`.
- **`tenant_id` is required on builds (once claimed), orders and devices.** An order references the tenant of the build it is for. It does not create or derive one.
- **Anonymous builds** have `tenant_id` null and an `anon_owner_hash` until claimed at sign-up (PORTAL.md §5).
- **Team tenants** use the same tables: a second tenant with more members and roles. Nothing about a personal tenant is special-cased except its default name.
- **Slugs are optional.** A personal tenant is served on the apex, resolved from the session. A slug (and a subdomain under [0007](0007-portal-routing.md)) is assigned when a tenant asks for one, and can't be one of the reserved names.
- Lands in **M1**, with `tenants`, `tenant_members` and `tenant_id` columns, as CLOUD-PLATFORM.md §11 already lists.

## Consequences

- `h(order)` stops being a tenant identifier. If it is needed for device provisioning, it remains a provisioning detail, not the root of the data model.
- Every gateway route resolves exactly one tenant per request — from the Host header on a tenant subdomain, otherwise from the session — and passes it as a bound parameter. The Ask tool loop (CLOUD-PLATFORM.md §7.4) already requires this.
- Moving a build between tenants (a person joining a team) is an explicit operation with an audit-log entry, not a side effect.
- Resolves the "Tenant or build as the root" row in ARCHITECTURE.md §18.1 once accepted.
