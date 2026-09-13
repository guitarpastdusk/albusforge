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
- **Don't apply a service's Terraform while its deploy workflow is running.** A change to any other part of the template (env vars, scaling, resources) makes the provider send the whole template, and for the ignored `image` it sends the value read at plan time. If a deploy lands a newer image between plan and apply, the apply writes the older image back and creates a revision that rolls the service back. The next deploy's freshness check deploys forward again, so it recovers, but the rollback is real. Before applying a change to a Cloud Run service, check that its deploy workflow isn't in progress, then re-plan and apply right away.
