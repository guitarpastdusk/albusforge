# 0001 — Shared CI project and single-digest promotion

**Status:** Accepted, 2026-09-12

## Context

ARCHITECTURE.md §12.3: CI builds one image per app, deploys that digest to staging, and promotion re-points prod at the *same* digest — "never build twice." Staging and prod are separate GCP projects. An Artifact Registry repo has to live in exactly one project, and whichever environment owns it gets implicit authority over the other's images.

## Decision

A third project, `albusforge-ci`, holds Artifact Registry, the Terraform state bucket, the GitHub WIF pool and the deployer service accounts.

- Both environments' Cloud Run service agents get `artifactregistry.reader` on the repo.
- `deploy-staging` gets `artifactregistry.writer`, while `deploy-prod` gets `artifactregistry.reader` only. **Prod cannot build or push**, so promoting a digest is the only way anything reaches prod.
- Tags are immutable (commit SHA).
- Each deployer can be impersonated only from a GitHub Actions job running in the matching GitHub environment. `prod` has required reviewers, and that approval is the manual promotion step.

## Consequences

- There is no staging → prod dependency, so staging can be torn down without affecting prod's images.
- Cross-project pulls depend on the service-agent binding. A new environment project needs one more `reader` binding in bootstrap.
- A workflow re-run that tries to push an existing SHA tag fails. That is intended.
