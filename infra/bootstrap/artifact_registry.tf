# One repo, in the CI project, for both environments: prod runs the exact digest
# staging ran. See docs/adr/0001-shared-ci-project.md.
resource "google_artifact_registry_repository" "images" {
  project       = google_project.this["ci"].project_id
  location      = var.region
  repository_id = "albusforge"
  format        = "DOCKER"
  description   = "Service and job images. Tagged by commit SHA; tags are immutable."

  docker_config {
    immutable_tags = true
  }

  depends_on = [google_project_service.this]
}

# Cloud Run pulls with its service agent, not the runtime SA.
resource "google_artifact_registry_repository_iam_member" "run_agent_reader" {
  for_each = local.envs

  project    = google_artifact_registry_repository.images.project
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${google_project.this[each.key].number}@serverless-robot-prod.iam.gserviceaccount.com"

  depends_on = [time_sleep.run_service_agent]
}
