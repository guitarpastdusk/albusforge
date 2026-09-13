# .github/scripts/

Shell scripts the deploy workflows call. They live outside the YAML so they can be tested.

| Script | Called by | What it does |
| --- | --- | --- |
| `lib.sh` | the others, sourced | `serving_image`: the image of the revision serving all traffic; `job_image`: the image of a job's latest successful execution; `image_tags`: the tag names on a digest; argument checks |
| `staging-freshness.sh` | `deploy-web.yml`, `deploy-gateway.yml`, `deploy-intake.yml` | refuses to replace the commit staging runs with an older or diverged one; prints `action=deploy` or `action=skip` |
| `mark-staging-deployed.sh` | `deploy-web.yml`, `deploy-gateway.yml`, `deploy-intake.yml` | tags a digest `staging-deployed-<commit>`, but only after confirming staging runs exactly that digest |
| `require-staging-deployed.sh` | `promote-web.yml`, `promote-gateway.yml`, `promote-intake.yml` | refuses to promote a digest that doesn't have that tag |
| `require-same-commit.sh` | `promote-gateway.yml` | refuses to promote images that different staging commits deployed (gateway with another commit's migrations); prints the shared commit |

## What runs the image

Each script reads `REPO` and one of:

| Env | Image | What "staging runs it" means |
| --- | --- | --- |
| `SERVICE=web` | `$REPO/web` (or `IMAGE`) | the revision serving all of the service's traffic |
| `JOBS="db-migrate registry-load"` and `IMAGE=db-jobs` | `$REPO/db-jobs` | each job's latest **successful** execution |
| `IMAGE=db-jobs` alone | `$REPO/db-jobs` | `require-staging-deployed.sh` only, which reads nothing but the registry |

deploy-web sets only `SERVICE=web`, so its behaviour is unchanged.

Both staging checks read what actually ran, not the desired state. A failed service deploy updates the desired image while traffic stays on the previous ready revision, and a job updated to a new image keeps that image in its template even when the execution fails. A retry must not mistake either for success.

In `JOBS` mode, freshness answers `skip` only if every job's last success already ran this commit, and a job that has never succeeded counts as a placeholder (`deploy`).

They call `gcloud`, `git` and `jq` from `PATH`. [`test/`](test/) runs them against a stub `gcloud`; CI runs it as the `deploy-scripts` job. The stub's `gcloud run jobs executions list` output follows the Cloud Run v1 Execution resource (`spec.template.spec.containers[0].image`, `status.conditions[type=Completed]`), which hasn't been checked against real `gcloud` output yet.

These workflows can't roll staging back to an older commit. That would be a separate, explicit workflow, which doesn't exist yet.
