resource "google_project" "this" {
  for_each = local.projects

  name                = "Albus Forge ${each.key}"
  project_id          = each.value
  billing_account     = var.billing_account
  auto_create_network = false
  deletion_policy     = "PREVENT"

  labels = {
    app = "albusforge"
    env = each.key
  }
}

locals {
  ci_services = [
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ]

  # Enabled up front through M6 so later milestones don't need a bootstrap
  # re-run. Enabling an API costs nothing; the resources behind it do.
  env_services = [
    "certificatemanager.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtrace.googleapis.com",
    "compute.googleapis.com",
    "dns.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "redis.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "serviceusage.googleapis.com",
    "sqladmin.googleapis.com",
  ]

  project_services = merge(
    { for s in local.ci_services : "ci/${s}" => { project = "ci", service = s } },
    { for pair in setproduct(local.envs, local.env_services) :
      "${pair[0]}/${pair[1]}" => { project = pair[0], service = pair[1] }
    },
  )
}

resource "google_project_service" "this" {
  for_each = local.project_services

  project            = google_project.this[each.value.project].project_id
  service            = each.value.service
  disable_on_destroy = false
}

# Cloud Run's service agent appears asynchronously after run.googleapis.com is
# enabled; IAM bindings naming it fail until it does.
resource "time_sleep" "run_service_agent" {
  create_duration = "90s"

  depends_on = [google_project_service.this]
}
