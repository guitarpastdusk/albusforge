# Third-party API keys. Terraform creates each secret empty; a person adds the
# value with `gcloud secrets versions add` (README), so no key is ever in state
# or in the repo. A service mounts a key only once a version exists: Cloud Run
# refuses to deploy a revision whose secret has no version.

resource "google_secret_manager_secret" "external" {
  for_each = toset([
    "anthropic-api-key", # intake (intake.tf)
    "resend-api-key",    # gateway sign-in codes (docs/adr/0008)
  ])

  project   = local.project_id
  secret_id = each.value

  replication {
    auto {}
  }
}

# Gateway's Resend access now comes from its secret_env mount (main.tf).
moved {
  from = google_secret_manager_secret_iam_member.gateway_resend
  to   = module.gateway.google_secret_manager_secret_iam_member.secret_env["RESEND_API_KEY"]
}
