# infra/env/

One root for every environment; the Terraform workspace selects which (`staging` or `prod`). Sizing differences live in the `settings` map in `locals.tf`. The named rollout variable files below record the reviewed initial activation flags and measured SQL alert ceilings.

Reads project IDs, DNS zones and domains from the bootstrap state, so `bootstrap/` must be applied and migrated first.

```sh
terraform init -backend-config=backend.hcl
terraform workspace select staging   # or: workspace new staging
terraform apply
```

The `default` workspace is not an environment and fails at plan with an invalid-key error on `local.settings`.

## What M0 creates

- **network** — VPC, one `/24`, Cloud NAT, private services access range (used by Cloud SQL in M1 and Memorystore in M4)
- **gateway** and **web**: placeholder Cloud Run services (the Google `hello` image) with the real ingress, egress and scaling. CI replaces the images; Terraform never touches them again
- **edge**: global HTTPS LB routing `/v1/*` to gateway and everything else to web, on the apex and every tenant subdomain. Also a Certificate Manager cert for the domain and its wildcard, a Cloud Armor rate limit, an HTTP→HTTPS redirect, and DNS A records

## What M1 adds

- **sql**: Cloud SQL Postgres 16, private IP only over the private services access peering, TLS required, PITR with 7 days of backups. `db-g1-small` in staging, `db-custom-2-7680` in prod. Terraform creates the database and the owner role `albus_migrate`; both database passwords are generated and stored in Secret Manager (`db-migrate-password`, `db-app-password`).
- **db-migrate** job: runs `packages/db` migrations as `albus_migrate`, then creates or updates the app role `albus_app` and its grants. The app role can read and write but can't change the schema.
- **registry-load** job: loads `registry/` into `registry.parts` as `albus_app`.
- **gateway** gets the database env vars and mounts `db-app-password`.
- **Empty secrets** `anthropic-api-key` and `resend-api-key`. Gateway can read the Resend key; intake gets the Anthropic key in M2.

Both jobs start with Google's sample job image; the gateway deploy workflow replaces them and executes each one, waiting for success, before deploying gateway (docs/adr/0005 applies to jobs too).

### Adding an API key

Run this yourself, per environment, so the key never passes through a terminal log, a chat, or Terraform state. `read -s` doesn't echo:

```sh
read -rs KEY && printf '%s' "$KEY" | gcloud secrets versions add anthropic-api-key \
  --project albusforge-staging --data-file=- && unset KEY
```

Use a separate key for staging and prod, with a spend limit set in the provider's console.

## What M2 adds

- **intake**: internal-only Cloud Run service (ask → spec). Gateway holds `run.invoker` on it and calls it with an ID token. It mounts `anthropic-api-key` and the app DB password, and uses `LLM_MODEL=claude-opus-5`.
- **gateway**: CPU always allocated, because it calls intake after replying to the client. It gets `INTAKE_URL` and mounts `resend-api-key`.
- **Drafts on staging:** `REGISTRY_INCLUDE_DRAFTS` is `true` in staging, so chat can use the draft parts, and `false` in prod.
- **LLM spend guardrail:** the log-based distribution metric `llm_cost`, built from intake's `event="llm_call"` log lines, with two alert policies (hourly and 24-hour budgets in `locals.tf`, one PromQL condition each) emailing `var.alert_email`. After apply, emit a test `llm_call` line to check the query and email delivery.

Mounting an API key requires a secret version to exist; both keys have one. ADR 0005 applies to intake too once its deploy workflow exists.

## Sensor rollout configuration

`rollout-staging.tfvars.json` and `rollout-prod.tfvars.json` are nonsecret, explicitly selected deployment inputs. Both environments now record their applied activation: model enabled with `claude-haiku-4-5` and schedules enabled, with SQL connection alert thresholds 37 for staging and 320 for production. Earlier disabled settings are preserved in the rollout ledger and git history. They are not auto-loaded: include the matching file on every plan so a later apply cannot silently restore the generic threshold. The private base `terraform.tfvars` remains local and ignored.

Before these commands, complete the [ADR 0005 exclusion window](../../docs/adr/0005-ci-owns-images-terraform-owns-shape.md): disable all affected deployment/promotion workflows, drain their complete paginated run histories and any already-started database/telemetry job executions, and pause affected schedules. Keep the window through apply. Plans made before the drain are inspection evidence only and must not be applied.

Run from `infra/env`, in a dedicated environment worktree. Initialize its backend from the existing approved `backend.hcl`; do not create a new backend or workspace to bypass a mismatch. Create a private evidence directory outside the repository first and replace `<private-evidence>` below with its absolute path.

```sh
terraform init -backend-config=backend.hcl
terraform workspace select staging
terraform plan -var-file=terraform.tfvars -var-file=rollout-staging.tfvars.json -out=<private-evidence>/staging.tfplan
# Review this fresh plan, especially existing image digests and unexpected changes.
terraform apply <private-evidence>/staging.tfplan
```

Production uses its own drained window and fresh plan:

```sh
terraform workspace select prod
terraform plan -var-file=terraform.tfvars -var-file=rollout-prod.tfvars.json -out=<private-evidence>/prod.tfplan
# Review this fresh plan after staging acceptance and production drain.
terraform apply <private-evidence>/prod.tfplan
```

Apply consumes the reviewed saved plan, including both variable files; do not pass replacement variables during apply. Raw plans/JSON may contain sensitive values and must stay private. If the base file resides elsewhere, use its explicit absolute path instead of copying secrets into this checkout. These commands document operator procedure, not permission to skip review or evidence that an apply happened.

Initial infrastructure creates placeholder service/job images. Promote verified immutable staging digests and establish schema readiness before invoking real processing. Root records activation flag changes alongside their acceptance evidence; operationally toggling schedules without updating desired configuration would introduce drift. See [the rollout ledger](../../docs/SENSOR-CLOUD-ROLLOUT.md).
