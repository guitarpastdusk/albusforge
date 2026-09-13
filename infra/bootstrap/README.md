# infra/bootstrap/

Runs once, before anything else, by a human whose ADC holds Billing Account User (and budget rights) on the billing account. Everything that must exist before an environment can be planned lives here.

| File | Creates |
| --- | --- |
| `projects.tf` | the three projects and their enabled APIs |
| `state.tf` | the versioned GCS bucket holding all Terraform state |
| `artifact_registry.tf` | the shared Docker repo; pull access for both envs' Cloud Run agents |
| `wif.tf` | GitHub OIDC pool/provider; `deploy-staging` and `deploy-prod` SAs |
| `dns.tf` | apex zone in prod, `staging.` subzone in staging, delegation between them |
| `budgets.tf` | prod budget at $150 / $300 / $500 |

State starts local — the bucket it would live in is created here — and is migrated into that bucket afterwards. See [`../README.md`](../README.md).
