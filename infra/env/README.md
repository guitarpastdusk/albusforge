# infra/env/

One root for every environment; the Terraform workspace selects which (`staging` or `prod`). Per-environment differences live in the `settings` map in `locals.tf` and nowhere else.

Reads project IDs, DNS zones and domains from the bootstrap state, so `bootstrap/` must be applied and migrated first.

```sh
terraform init -backend-config=backend.hcl
terraform workspace select staging   # or: workspace new staging
terraform apply
```

The `default` workspace is not an environment and fails at plan with an invalid-key error on `local.settings`.

## What M0 creates

- **network** — VPC, one `/24`, Cloud NAT, private services access range (used by Cloud SQL in M1 and Memorystore in M4)
- **gateway** — a placeholder Cloud Run service (the Google `hello` image) with the real ingress, egress and scaling. CI replaces the image; Terraform never touches it again
- **edge** — global HTTPS LB, Certificate Manager cert for the domain and its wildcard, Cloud Armor rate limit, HTTP→HTTPS redirect, DNS A records
