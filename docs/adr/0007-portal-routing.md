# 0007 — Portal on the apex; `/v1` to gateway, everything else to web

**Status:** Accepted, 2026-09-13. Amended the same day: SSR request contract.

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

- **Server-side rendering must call gateway internally**, through its `run.app` URL over the VPC. A call through the public domain exits through Cloud NAT, and Cloud Armor then counts every user against a single IP. An internal call loses the browser's hostname and IP, so it follows the SSR request contract below.
- **Cookie scope needs care.** Staging lives *under* the prod apex, so any prod cookie set with `Domain=albusforge.ai` is also sent to `staging.albusforge.ai` and every staging tenant subdomain. Session cookies should be **host-only**, with no `Domain` attribute, and signing in on a tenant subdomain should go through a redirect handoff instead of a parent-domain cookie. If a shared parent-domain session turns out to be necessary, move staging to a separate registered domain first.
- Both backends share one Cloud Armor policy. A page that loads many static assets counts each one against the per-IP limit. If that bites before assets move behind a CDN backend bucket, give web its own policy with a higher threshold.
- M6's `/ingest/*` rule and M7's media bucket are added as further `path_rules` or host rules. They don't replace this matcher.

## SSR request contract

Gateway resolves the tenant from the hostname (ADR 0009) and rate-limits by client IP (ADR 0008). A server-side request from web to `GATEWAY_INTERNAL_URL` carries neither: its `Host` is gateway's `run.app` hostname, and its source is web. Web therefore forwards both, and gateway accepts them only from web.

**Web sends**, on every SSR call to `GATEWAY_INTERNAL_URL`:

| Header | Value |
| --- | --- |
| `X-Albus-Internal-Auth` | `Bearer <ID token>`: a Google-signed ID token for web's runtime SA, with audience `GATEWAY_INTERNAL_URL`, minted from the metadata server |
| `X-Albus-Original-Host` | the host the browser requested |
| `X-Albus-Client-IP` | the visitor's IP |
| `Cookie` | the two authentication cookies only, the session cookie and the anonymous owner cookie (PORTAL.md §5). Never the browser's full cookie header |

**Gateway trusts `X-Albus-Original-Host` and `X-Albus-Client-IP` only when `X-Albus-Internal-Auth` verifies:** a valid Google signature, `aud` equal to gateway's URL, `email` equal to `SSR_SERVICE_ACCOUNT` with `email_verified`, and not expired. Otherwise it ignores both headers and uses the real `Host` and client IP. A trusted original host must be `PUBLIC_DOMAIN` or `<slug>.PUBLIC_DOMAIN` with a well-formed slug, or the request gets a 400. Tenant resolution and the membership check then run exactly as for a browser request.

**The load balancer removes all three `X-Albus-*` headers from every public request** (`strip_request_headers` in the edge module), so a browser cannot send them. That is defense in depth; the ID-token check is the control, because a request that reaches `run.app` directly never passes through the load balancer.

Terraform sets `PUBLIC_DOMAIN` and `GATEWAY_INTERNAL_URL` on web, and `PUBLIC_DOMAIN` and `SSR_SERVICE_ACCOUNT` on gateway.

Why not rely on Cloud Run IAM: gateway is publicly invokable behind the load balancer (`allUsers`), so Cloud Run does not check who the caller is. Gateway has to verify web's identity itself.
