# Staging storage acceptance

The CLI is prepared for the existing staging environment only. It creates no
resources until `--execute` is supplied. Wait for the authorized coordinator to
apply the reviewed infrastructure before running it.

```sh
pnpm --filter @albusforge/storage build
pnpm --filter @albusforge/storage acceptance:staging \
  --project albusforge-staging --bucket albusforge-staging-observations
```

This prints the plan without loading ADC or contacting Google Cloud. After the
approved staging apply, append `--execute` to run acceptance. Production and
arbitrary bucket names are rejected. The CLI impersonates these identities using
the operator's existing ADC and ten-minute target tokens:

- `cloudlink-run@albusforge-staging.iam.gserviceaccount.com`
- `gateway-run@albusforge-staging.iam.gserviceaccount.com`
- `observation-maintain-run@albusforge-staging.iam.gserviceaccount.com`

The operator must already have permission to mint tokens for those service
accounts. The CLI does not grant IAM, print tokens, create service-account keys,
change bucket configuration, or enable runtime flags. Use existing user/workload
ADC, never a downloaded service-account key.

The 17 checks exercise actual isolated storage workers: each role's allowed
operations, forbidden write/delete/list operations, unsigned read denial,
immutable creation conflicts, persisted identity metadata, exact JPEG bytes,
generation changes, stale delete protection and deleted-generation read denial.
Each run uses a unique `acceptance/<UUID>/` prefix and a synthetic 8×8 JPEG, with
no camera or user data. Exact-generation cleanup runs after success and failure,
including writes unexpectedly permitted by overly broad IAM. Cleanup errors
identify only the affected fixture keys and fail the run.

Seven-day soft delete can retain those tiny deleted fixtures after active-object
cleanup; the CLI does not bypass retention. Provider lifecycle timing and
SQL/application expiry still require the separate maintenance integration checks.
An IAM, ADC or networking failure is never accepted as evidence of correct
permission denial unless that same identity first completed its allowed action.
