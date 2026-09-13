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
- **gateway** and **web**: placeholder Cloud Run services (the Google `hello` image) with the real ingress, egress and scaling. CI replaces the images; Terraform never touches them again
- **edge**: global HTTPS LB routing `/v1/*` to gateway and everything else to web, on the apex and every tenant subdomain. Also a Certificate Manager cert for the domain and its wildcard, a Cloud Armor rate limit, an HTTP→HTTPS redirect, and DNS A records
