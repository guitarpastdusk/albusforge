# 0004 — Cloud Run egress is all-traffic through the VPC, with Cloud NAT

**Status:** Accepted, 2026-09-12

## Context

Internal services (intake, matcher, codegen, …) use internal-only ingress. Cloud Run treats a request from another Cloud Run service as internal only if it leaves the caller **through the VPC**. With direct VPC egress set to `PRIVATE_RANGES_ONLY`, a call to a `*.run.app` URL goes out over the public path and is rejected. The architecture documents choose direct VPC egress (§12.3) but don't say which egress mode.

Services also call the public internet: the Anthropic API, the email provider, and later supplier and print-partner APIs.

## Decision

- Every Cloud Run service and job uses direct VPC egress with `ALL_TRAFFIC`.
- Each environment's VPC has a Cloud Router and Cloud NAT so that egress can still reach the internet.

## Consequences

- Service-to-service calls authenticate with IAM (`run.invoker`) and also pass the internal-ingress check.
- NAT costs about $1/month per gateway plus per-GB processing. That is small at MVP volume but belongs in the §12.5 baseline.
- Outbound traffic leaves from NAT IPs. If a supplier needs an allowlist, switch NAT to static reserved IPs.
- Private Google Access is enabled on the subnet so Google API calls don't consume NAT.
