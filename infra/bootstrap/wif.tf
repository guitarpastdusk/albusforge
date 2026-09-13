resource "google_iam_workload_identity_pool" "github" {
  project                   = google_project.this["ci"].project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.this]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = google_project.this["ci"].project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.repository_owner_id == '${var.github_repository_owner_id}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# One deployer per environment, each impersonable only from a job running in
# the matching GitHub environment (sub = repo:<repo>:environment:<env>).
resource "google_service_account" "deployer" {
  for_each = local.envs

  project      = google_project.this["ci"].project_id
  account_id   = "deploy-${each.key}"
  display_name = "GitHub Actions deployer (${each.key})"

  # The IAM bindings below reach the API only through this resource, so this
  # one dependency orders all of them.
  depends_on = [google_project_service.this]
}

resource "google_service_account_iam_member" "deployer_wif" {
  for_each = local.envs

  service_account_id = google_service_account.deployer[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/subject/repo:${var.github_repository}:environment:${each.key}"
}

locals {
  # M0 grants. iam.serviceAccountUser is project-wide for now; narrow it to the
  # runtime SAs once env/ creates them all (M1+).
  deployer_env_roles = [
    "roles/run.developer",
    "roles/iam.serviceAccountUser",
  ]
}

resource "google_project_iam_member" "deployer_env" {
  for_each = {
    for pair in setproduct(local.envs, local.deployer_env_roles) :
    "${pair[0]}/${pair[1]}" => { env = pair[0], role = pair[1] }
  }

  project = google_project.this[each.value.env].project_id
  role    = each.value.role
  member  = google_service_account.deployer[each.value.env].member
}

# Staging builds and pushes. Prod only reads — it can never build.
resource "google_artifact_registry_repository_iam_member" "deployer" {
  for_each = {
    staging = "roles/artifactregistry.writer"
    prod    = "roles/artifactregistry.reader"
  }

  project    = google_artifact_registry_repository.images.project
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = each.value
  member     = google_service_account.deployer[each.key].member
}
