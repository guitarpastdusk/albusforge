# 0003 — Public traffic enters only through the load balancer; ingest gets its own backend

**Status:** Accepted, 2026-09-12

## Context

Two statements in the architecture documents don't hold as written:

1. ARCHITECTURE.md §6.1 gives gateway `ingress: all`. With that setting, the service's `*.run.app` URL is publicly reachable, which **bypasses Cloud Armor** and the load balancer entirely.
2. CLOUD-PLATFORM.md §4.1 draws `POST /ingest/v1` on cloudlink as "Cloud Run internal". WiFi and LTE-M devices post from the public internet, so an internal-only service is unreachable to them. §4.4 also places a per-device-token rate limit "at the edge", which only exists if ingest sits behind the LB.

## Decision

- Every public-facing service uses `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`, never `all`.
- Gateway is the default backend. **In M6, cloudlink's ingest route gets its own serverless NEG and backend service** on the same LB, reached through a path rule for `/ingest/*`. A dedicated `ingest.` hostname is preferred so device traffic can be split off later. It gets its own Cloud Armor policy, keyed on the `Authorization` header rather than IP.
- Every other service stays `INGRESS_TRAFFIC_INTERNAL_ONLY`.

## Consequences

- Ingest does not share a failure domain with the gateway process, which is what CLOUD-PLATFORM.md §10 requires of the only path whose outage loses data.
- `ingest` joins the reserved tenant slugs.
- The §6.1 wording ("gateway is the only service with `ingress: all`") should become "gateway and cloudlink's ingest route are the only LB-reachable services".
