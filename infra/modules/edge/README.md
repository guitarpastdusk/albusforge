# infra/modules/edge/

The public front door for one environment (ARCHITECTURE.md §6.1):

- a **global external Application Load Balancer** on a static IP, with 80 redirected to 443
- a **Certificate Manager** cert covering `domain` and `*.domain`, validated by DNS authorization. Wildcards are why this uses Certificate Manager instead of classic managed certs. The wildcard is for per-tenant hosting (CLOUD-PLATFORM.md §6.4)
- one **serverless NEG + backend service per entry in `services`**
- a **URL map with a single path matcher applied to every hostname**, so the apex and tenant subdomains route identically ([ADR 0007](../../../docs/adr/0007-portal-routing.md))
- **Cloud Armor** with a per-IP throttle on every backend; the gateway's in-app rate limiter stays as defense in depth
- **A records** for `domain` and `*.domain`, plus the `_acme-challenge` CNAME

As composed by `env/`:

| Path | Backend |
| --- | --- |
| `/v1`, `/v1/*` | gateway |
| everything else | web |

M6 adds `/ingest/*` → cloudlink ([ADR 0003](../../../docs/adr/0003-edge-lb-only-ingress-and-separate-ingest-backend.md)), and M7 adds the media backend bucket with Cloud CDN.

## Reserved hostnames

Tenant slugs share the wildcard with fixed hostnames. The gateway must refuse these as tenant slugs: `staging`, `app`, `api`, `www`, `ingest`. Add to the list before creating any new fixed hostname under the domain.

## Server-side calls from web

When web renders on the server, it must call gateway's `run.app` URL, which travels internally through the VPC, and **not** the public domain. A server-side request through the public domain leaves through Cloud NAT, so Cloud Armor sees every user as the same NAT IP and the per-IP throttle rate-limits the whole site at once.

An internal call loses the browser's hostname and IP. Web forwards them in `X-Albus-Original-Host` and `X-Albus-Client-IP`, alongside an ID token in `X-Albus-Internal-Auth` that gateway verifies before trusting either. `strip_request_headers` removes all three from every public request, so a browser can't send them. The full contract is in [ADR 0007](../../../docs/adr/0007-portal-routing.md#ssr-request-contract).
