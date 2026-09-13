# infra/

Terraform for Albus Forge on GCP. Scope today is **M0 — Ground** (`docs/ARCHITECTURE.md` §16); later milestones add modules here rather than new roots.

| Path | What it is | Applied |
| --- | --- | --- |
| [`bootstrap/`](bootstrap/) | Projects, APIs, state bucket, Artifact Registry, GitHub WIF, deployer SAs, DNS zones, prod budget | once, by a human with billing rights |
| [`env/`](env/) | One environment: VPC, NAT, private services access, gateway placeholder, HTTPS load balancer, Cloud Armor, certs | per workspace: `staging`, `prod` |
| [`modules/`](modules/) | `network`, `run_service`, `edge` | via `env/` |

Decisions behind the shape: [`docs/adr/`](../docs/adr/).

## Projects

| Project | Holds |
| --- | --- |
| `albusforge-ci` | Terraform state, Artifact Registry (the only place images are built into), WIF pool, deployer SAs |
| `albusforge-staging` | staging runtime; DNS zone `staging.albusforge.ai` |
| `albusforge-prod` | prod runtime; DNS zone `albusforge.ai` (apex) |

Project IDs are global. If any is taken, set `project_suffix` in `bootstrap/terraform.tfvars`.

## First-time setup

```sh
# 0. auth
gcloud auth application-default login

# 1. bootstrap — local state on the first run, because the state bucket doesn't exist yet
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars   # set billing_account
terraform init
terraform apply

# 2. move bootstrap state into the bucket it just created
#    uncomment the backend block in backend.tf, then:
terraform init -migrate-state -backend-config="bucket=$(terraform output -raw tfstate_bucket)"

# 3. point GoDaddy at Cloud DNS — see "Domain" below
terraform output prod_name_servers

# 4. environments
cd ../env
cp backend.hcl.example backend.hcl             # set bucket
cp terraform.tfvars.example terraform.tfvars   # set tfstate_bucket
terraform init -backend-config=backend.hcl
terraform workspace new staging && terraform apply
terraform workspace new prod    && terraform apply
```

## Domain — `albusforge.ai` at GoDaddy

Keep the **registration** at GoDaddy; move only **DNS** to Cloud DNS ([ADR 0002](../docs/adr/0002-dns-cloud-dns-delegated-from-godaddy.md)).

1. **Before switching**, look at the records GoDaddy currently serves (DNS → Records). Anything real — MX and SPF/DKIM TXT for email, site-verification TXT — must be recreated in the prod zone first, or it stops resolving the moment the nameservers change. Parked-page A/CNAME records can be dropped.
2. GoDaddy → the domain → **DNS → Nameservers → Change → "I'll use my own nameservers"** → enter the four values from `terraform output prod_name_servers`.
3. Propagation is usually under an hour, occasionally up to 48 h. Check with `dig NS albusforge.ai +short`.
4. Certificate Manager issues certs only once the `_acme-challenge` CNAMEs resolve publicly, so the load balancer serves TLS errors until step 3 completes. That is expected.

## GitHub

Deploys authenticate through WIF, with no JSON keys. The trust is bound to **GitHub environments**, not branches:

- Create environments `staging` and `prod` under repo Settings → Environments.
- Give `prod` required reviewers. That approval *is* the manual promotion step in §12.3.
- A workflow job must declare `environment: staging` or `environment: prod` to get credentials. `terraform output github_actions` prints the provider and SA values for `google-github-actions/auth`.

The staging deployer can push images; the prod deployer can only read them. That enforces "never build twice" in IAM, not just in convention.

## Troubleshooting

- **`Service account service-…@serverless-robot-prod… does not exist`** on the first bootstrap apply: the Cloud Run service agent is provisioned asynchronously after the API is enabled. There is a 90 s wait built in; if it still races, re-run `apply`.
- **`project … already exists`** or permission denied on project create: the ID is taken globally. Set `project_suffix`.
- **Quota project errors** from ADC: `gcloud auth application-default set-quota-project albusforge-ci` once that project exists.
- **Plan wants to change the Cloud Run image:** it shouldn't — images are ignored ([ADR 0005](../docs/adr/0005-ci-owns-images-terraform-owns-shape.md)). If a `gcloud run deploy` adds a new field Terraform then fights over, add it to `ignore_changes` in `modules/run_service`.
