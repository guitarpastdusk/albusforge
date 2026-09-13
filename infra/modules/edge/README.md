# infra/modules/edge/

The public front door for one environment (ARCHITECTURE.md §6.1):

- a **global external Application Load Balancer** on a static IP, with 80 redirected to 443
- a **Certificate Manager** cert covering `domain` and `*.domain`, validated by DNS authorization. Wildcards are why this uses Certificate Manager instead of classic managed certs. The wildcard is for per-tenant hosting (CLOUD-PLATFORM.md §6.4)
- **Cloud Armor** with a per-IP throttle; the gateway's in-app rate limiter stays as defense in depth
- a **serverless NEG** to the default Cloud Run service
- **A records** for `domain` and `*.domain`, plus the `_acme-challenge` CNAME

The URL map has a single default service today. M6 adds a second backend for `/ingest/v1` → cloudlink, and M7 adds the media backend bucket with Cloud CDN ([ADR 0003](../../../docs/adr/0003-edge-lb-only-ingress-and-separate-ingest-backend.md)).

**Tenant slugs** share the wildcard with fixed hostnames (`staging`, and later `ingest`, `api`, `www`), so the gateway must reserve those slugs.
