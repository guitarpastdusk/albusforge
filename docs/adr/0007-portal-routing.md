# 0007 — Portal on the apex; `/v1` to gateway, everything else to web

**Status:** Accepted, 2026-09-13

## Context

The M0 load balancer sent every host and path to gateway. The portal is its own service (`web`) and needs:

- `/v1/*` → gateway, which is the API and includes the SSE streams
- everything else → web
- tenant subdomains (`acme-plant.albusforge.ai`) served by web as well, because the Live systems screens run there, with their `/v1` still going to gateway

The portal could live on the apex or on its own subdomain (`app.`). Deciding now is free; after staging is applied, it becomes a change to live infrastructure.

## Decision

- **The portal serves the apex.** `albusforge.ai` in prod and `staging.albusforge.ai` in staging.
- The URL map has **one path matcher, applied to every hostname** (`hosts = ["*"]`): `/v1` and `/v1/*` go to gateway, and all other paths go to web. The apex and tenant subdomains route identically. Web and gateway resolve the tenant from the `Host` header (CLOUD-PLATFORM.md §6.4).
- The API stays same-origin on every host, so the browser never makes a cross-origin API call and needs no CORS.
- `app` is added to the reserved tenant slugs anyway, alongside `staging`, `api`, `www` and `ingest`, so the portal can move there later without taking a name from a tenant.

## Consequences

- **Server-side rendering must call gateway internally**, through its `run.app` URL over the VPC. A call through the public domain exits through Cloud NAT, and Cloud Armor then counts every user against a single IP.
- **Cookie scope needs care.** Staging lives *under* the prod apex, so any prod cookie set with `Domain=albusforge.ai` is also sent to `staging.albusforge.ai` and every staging tenant subdomain. Session cookies should be **host-only**, with no `Domain` attribute, and signing in on a tenant subdomain should go through a redirect handoff instead of a parent-domain cookie. If a shared parent-domain session turns out to be necessary, move staging to a separate registered domain first.
- Both backends share one Cloud Armor policy. A page that loads many static assets counts each one against the per-IP limit. If that bites before assets move behind a CDN backend bucket, give web its own policy with a higher threshold.
- M6's `/ingest/*` rule and M7's media bucket are added as further `path_rules` or host rules. They don't replace this matcher.
