# New projects grant the default Compute Engine service account roles/editor
# on the whole project. Nothing here runs as it: every Cloud Run service and
# job has its own runtime SA (modules/run_service). But `gcloud run deploy`
# against a missing service, or any resource created without an explicit SA,
# would run with Editor. Strip the grant rather than rely on nobody using it.
#
# The CI project doesn't enable Compute, so it has no default compute SA.
resource "google_project_default_service_accounts" "deprivilege" {
  for_each = local.envs

  project = google_project.this[each.key].project_id
  action  = "DEPRIVILEGE"

  # Removing this resource must not silently re-grant Editor.
  restore_policy = "NONE"

  depends_on = [google_project_service.this]
}
