# Third-party API keys. Terraform creates each secret empty; a person adds the
# value with `gcloud secrets versions add` (README), so no key is ever in state
# or in the repo. A service mounts a key only once a version exists: Cloud Run
# refuses to deploy a revision whose secret has no version.

resource "google_secret_manager_secret" "external" {
  for_each = toset([
    "anthropic-api-key", # intake, M2
    "resend-api-key",    # gateway sign-in codes, M2 (docs/adr/0008)
  ])

  project   = local.project_id
  secret_id = each.value

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "gateway_resend" {
  secret_id = google_secret_manager_secret.external["resend-api-key"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = module.gateway.service_account_member
}
