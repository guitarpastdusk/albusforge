# 0002 — DNS in Cloud DNS, delegated from GoDaddy

**Status:** Accepted, 2026-09-12

## Context

`albusforge.ai` is registered at GoDaddy. The platform needs records created by Terraform: load balancer A records, Certificate Manager `_acme-challenge` CNAMEs, and a wildcard for per-tenant hosting (CLOUD-PLATFORM.md §6.4). Managing those by hand in GoDaddy's UI puts part of every environment outside Terraform. Moving the registration itself buys nothing: `.ai` transfers are slow and paid, and the registrar isn't what we need to automate.

## Decision

- **Registration stays at GoDaddy.** Only nameservers change, to Cloud DNS.
- The **apex zone lives in the prod project**. Staging gets its **own zone for `staging.albusforge.ai`** in the staging project, delegated by an NS record in the apex zone.
- Both zones and the delegation are created in `infra/bootstrap`. Each environment root writes records only in its own project's zone.

## Consequences

- Every record that GoDaddy currently serves and that matters (email MX, SPF/DKIM, verification TXT) must be recreated in Cloud DNS **before** the nameserver switch.
- Staging Terraform can't edit a prod record.
- The apex zone's lifetime is tied to the prod project, which already has `deletion_policy = PREVENT`.
- Cloud DNS costs about $0.20/zone/month plus queries.
- DNSSEC is off. Enabling it later means turning it on in the zone and adding the DS record at GoDaddy.
