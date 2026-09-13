# 0005 — CI owns images; Terraform owns everything else

**Status:** Accepted, 2026-09-12

## Context

"We will be terraforming everything" and "promotion re-points traffic at the same digest" both touch the Cloud Run service. If Terraform pins the image, every deploy is a Terraform apply, which puts state-lock contention and plan review in the deploy path. If CI deploys with `gcloud` and Terraform also sets the image, the next `terraform apply` silently rolls production back.

## Decision

- Terraform creates each Cloud Run service and job with a placeholder image and owns everything except the image: ingress, egress, scaling, resources, service accounts, environment variables and IAM.
- `image`, `client` and `client_version` are in `lifecycle.ignore_changes`.
- CI deploys with `gcloud run deploy --image <repo>@sha256:…`.

## Consequences

- Deploys are fast and need no state access, so the deployer SAs don't need to read Terraform state.
- The image running in an environment is visible in Cloud Run and CI history, not in Terraform state.
- Config changes (for example an env var) go through Terraform and create a new revision **with the current image**, because the ignored field keeps its live value.
- If `gcloud` later starts writing another field that Terraform diffs on, add it to `ignore_changes` rather than dropping this rule.
