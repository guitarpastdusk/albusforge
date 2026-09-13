data "terraform_remote_state" "bootstrap" {
  backend = "gcs"
  config = {
    bucket = var.tfstate_bucket
    prefix = "bootstrap"
  }
}

locals {
  env = terraform.workspace

  # Every per-environment difference lives here.
  all_settings = {
    staging = {
      subnet_cidr           = "10.10.0.0/24"
      psa_address           = "10.110.0.0"
      gateway_min_instances = 0
      web_min_instances     = 0
      sql_tier              = "db-g1-small" # ARCHITECTURE.md §5.2
      deletion_protection   = false

      # Every MVP part is still a draft; staging shows them so chat can be tested.
      registry_include_drafts = true
      llm_build_token_ceiling = 200000
      llm_hourly_budget_usd   = 5
      llm_daily_budget_usd    = 20
    }
    prod = {
      subnet_cidr           = "10.20.0.0/24"
      psa_address           = "10.120.0.0"
      gateway_min_instances = 1 # SSE and cold-start UX, ARCHITECTURE.md §12.2
      web_min_instances     = 1 # first page load shouldn't wait on a cold start
      sql_tier              = "db-custom-2-7680"
      deletion_protection   = true

      registry_include_drafts = false
      llm_build_token_ceiling = 200000
      llm_hourly_budget_usd   = 10
      llm_daily_budget_usd    = 50
    }
  }

  settings  = local.all_settings[local.env]
  bootstrap = data.terraform_remote_state.bootstrap.outputs

  project_id = local.bootstrap.project_ids[local.env]
  domain     = local.bootstrap.env_domains[local.env]
  dns_zone   = local.bootstrap.dns_zones[local.env]
  name       = "albusforge-${local.env}"

  # Sent by web's SSR to gateway's run.app URL; gateway trusts them only with a
  # valid ID token from web's SA. Stripped from every public request.
  # docs/adr/0007-portal-routing.md
  # Created by the db-migrate job, not Terraform (modules/sql).
  db_app_role = "albus_app"

  internal_request_headers = [
    "X-Albus-Internal-Auth",
    "X-Albus-Original-Host",
    "X-Albus-Client-IP",
  ]
}
