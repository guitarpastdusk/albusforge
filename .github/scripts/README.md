# .github/scripts/

Shell scripts the web deploy workflows call. They live outside the YAML so they can be tested.

| Script | Called by | What it does |
| --- | --- | --- |
| `lib.sh` | the others, sourced | `image_tags`: the tag names on a digest in Artifact Registry; argument checks |
| `staging-freshness.sh` | `deploy-web.yml` | refuses to replace what staging runs with an older or diverged commit; prints `action=deploy` or `action=skip` |
| `mark-staging-deployed.sh` | `deploy-web.yml` | tags a digest `staging-deployed-<commit>` after a successful staging deploy |
| `require-staging-deployed.sh` | `promote-web.yml` | refuses to promote a digest that doesn't have that tag |

They call `gcloud`, `git` and `jq` from `PATH`. [`test/`](test/) runs them against a stub `gcloud`; CI runs it as the `deploy-scripts` job.

These workflows can't roll staging back to an older commit. That would be a separate, explicit workflow, which doesn't exist yet.
