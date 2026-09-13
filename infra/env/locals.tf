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
      deletion_protection   = false
    }
    prod = {
      subnet_cidr           = "10.20.0.0/24"
      psa_address           = "10.120.0.0"
      gateway_min_instances = 1 # SSE and cold-start UX, ARCHITECTURE.md §12.2
      web_min_instances     = 1 # first page load shouldn't wait on a cold start
      deletion_protection   = true
    }
  }

  settings  = local.all_settings[local.env]
  bootstrap = data.terraform_remote_state.bootstrap.outputs

  project_id = local.bootstrap.project_ids[local.env]
  domain     = local.bootstrap.env_domains[local.env]
  dns_zone   = local.bootstrap.dns_zones[local.env]
  name       = "albusforge-${local.env}"
}
