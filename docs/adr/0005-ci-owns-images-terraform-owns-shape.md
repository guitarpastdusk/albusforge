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
- **Don't apply a service's or job's Terraform while a workflow that deploys it is running.** A change to any other part of the template (env vars, scaling, resources) makes the provider send the whole template, and for the ignored `image` it sends the value read at plan time. If a deploy lands a newer image between plan and apply, the apply writes the older image back and creates a revision that rolls the service back. **The service stays rolled back until another deploy succeeds.** A later deploy run sees the older commit serving and deploys forward, but nothing triggers that automatically. Checking for a running deploy before planning isn't enough either, because a deploy can still start between plan and apply.

  The same race applies to Cloud Run jobs: an apply can write an older image back into `db-migrate` or `registry-load`, and the next execution then runs old code against a newer schema. `gateway`, `db-migrate` and `registry-load` are one unit here, because the same workflows deploy all three. Applying Terraform that touches any of them means keeping out both gateway workflows.

  | Resources the plan touches | Workflows to disable and drain |
  | --- | --- |
  | `web` | `deploy-web.yml` (staging), `promote-web.yml` (prod) |
  | `gateway`, `db-migrate` or `registry-load` | `deploy-gateway.yml` (staging), `promote-gateway.yml` (prod) |
  | several, or not sure | all four for that environment |

  To keep deploys out for the whole window:
  1. Disable each workflow from the table: for example `gh workflow disable deploy-gateway.yml` for staging, `gh workflow disable promote-gateway.yml` for prod.
  2. Make sure every existing run of each of those workflows has **completed**. Disabling stops new triggers but doesn't cancel runs that already exist. Every deploy workflow uses `concurrency` with `cancel-in-progress: false`, so a run created before you disabled the workflow can still be queued, pending or waiting behind another deploy, and start during the apply. Let those runs finish or cancel them, then confirm nothing is left across each workflow's **entire** run history. (`gh run list` only returns the latest 20 runs, so it can't prove this.)

     A cancelled gateway run doesn't stop a job execution it already started: `gcloud run jobs execute --wait` only waits on it. Also list the executions of `db-migrate` and `registry-load` in the project you're applying (`gcloud run jobs executions list --job <job> --project <project> --region us-central1`), and cancel or wait out any that haven't completed.

     For each workflow file, this command must exit successfully and print `0`:
     ```sh
     set -o pipefail
     gh api --paginate --slurp 'repos/guitarpastdusk/albusforge/actions/workflows/<file>/runs?per_page=100' \
       | jq '[.[].workflow_runs[] | select(.status != "completed")] | length'
     ```
     `gh` won't combine `--slurp` with `--jq`, so the count runs in a separate `jq`. `pipefail` makes a failed API call fail the check instead of printing a misleading `0`.
  3. Re-plan, check the plan, and apply.
  4. Re-enable each workflow with `gh workflow enable`.

  While a workflow is disabled, pushes to `main` don't trigger it. If an image-changing commit landed during the window, dispatch `deploy-web` or `deploy-gateway` once it's re-enabled.
