# .github/scripts/

Shell scripts the web deploy workflows call. They live outside the YAML so they can be tested.

| Script | Called by | What it does |
| --- | --- | --- |
| `lib.sh` | the others, sourced | `serving_image`: the image of the revision serving all traffic; `image_tags`: the tag names on a digest; argument checks |
| `staging-freshness.sh` | `deploy-web.yml` | refuses to replace the commit staging serves with an older or diverged one; prints `action=deploy` or `action=skip` |
| `mark-staging-deployed.sh` | `deploy-web.yml` | tags a digest `staging-deployed-<commit>`, but only after confirming staging serves exactly that digest |
| `require-staging-deployed.sh` | `promote-web.yml` | refuses to promote a digest that doesn't have that tag |

Both staging checks read the **serving** revision, not the service's desired image. A failed deploy updates the desired image while traffic stays on the previous ready revision, and a retry must not mistake that for success.

They call `gcloud`, `git` and `jq` from `PATH`. [`test/`](test/) runs them against a stub `gcloud`; CI runs it as the `deploy-scripts` job.

These workflows can't roll staging back to an older commit. That would be a separate, explicit workflow, which doesn't exist yet.
