variable "billing_account" {
  description = "Billing account ID linked to all three projects (XXXXXX-XXXXXX-XXXXXX)."
  type        = string
}

variable "project_prefix" {
  description = "Prefix for project IDs."
  type        = string
  default     = "albusforge"
}

variable "project_suffix" {
  description = "Appended to every project ID, e.g. \"-a7\". Project IDs are global; use this if one is taken."
  type        = string
  default     = ""
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "root_domain" {
  description = "Apex domain. Prod serves the apex; staging serves staging.<apex>."
  type        = string
  default     = "albusforge.ai"
}

variable "github_repository" {
  description = "owner/name of the repo allowed to deploy."
  type        = string
  default     = "guitarpastdusk/albusforge"
}

variable "github_repository_owner_id" {
  description = "Numeric GitHub owner ID. Pinned alongside the name so a deleted-and-recreated owner can't inherit trust."
  type        = string
}

variable "github_repository_id" {
  description = "Numeric GitHub repository ID. Part of the repository's immutable OIDC subject, and pinned in the provider condition."
  type        = string
}

variable "prod_budget_usd" {
  description = "Monthly prod budget. Alerts fire at 30/60/100% — $150 / $300 / $500 at the default."
  type        = number
  default     = 500
}

locals {
  projects = {
    ci      = "${var.project_prefix}-ci${var.project_suffix}"
    staging = "${var.project_prefix}-staging${var.project_suffix}"
    prod    = "${var.project_prefix}-prod${var.project_suffix}"
  }

  envs = toset(["staging", "prod"])

  env_domains = {
    staging = "staging.${var.root_domain}"
    prod    = var.root_domain
  }
}
