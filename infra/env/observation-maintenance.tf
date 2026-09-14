module "observation_maintain" {
  source              = "../modules/run_job"
  project_id          = local.project_id
  region              = var.region
  name                = "observation-maintain"
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  timeout             = "300s"
  max_retries         = 0
  memory              = "512Mi"
  deletion_protection = local.settings.deletion_protection
  env = merge(local.db_env, {
    DB_USER                         = local.db_app_role
    DB_POOL_MAX                     = "2"
    OBSERVATION_BUCKET              = google_storage_bucket.observations.name
    OBSERVATION_MAINTENANCE_LIMIT   = "100"
    OBSERVATION_ORPHAN_GRACE_S      = "120"
    OBSERVATION_STORAGE_WORKER_PATH = "/app/storage-worker.cjs"
    GOOGLE_CLOUD_PROJECT            = local.project_id
  })
  secret_env = { DB_PASSWORD = { secret = module.sql.app_password_secret } }
}

# Reuse the invocation-only scheduler principal, with no object or SQL access.
resource "google_cloud_run_v2_job_iam_member" "observation_scheduler" {
  project  = local.project_id
  location = var.region
  name     = module.observation_maintain.name
  role     = "roles/run.invoker"
  member   = google_service_account.telemetry_scheduler.member
}

resource "google_cloud_scheduler_job" "observation_maintain" {
  project          = local.project_id
  region           = var.region
  name             = "observation-maintain"
  schedule         = "17 * * * *"
  time_zone        = "Etc/UTC"
  paused           = !var.observation_schedule_enabled
  attempt_deadline = "30s"
  retry_config { retry_count = 0 }
  http_target {
    uri         = "https://run.googleapis.com/v2/projects/${local.project_id}/locations/${var.region}/jobs/${module.observation_maintain.name}:run"
    http_method = "POST"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.telemetry_scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
  depends_on = [google_cloud_run_v2_job_iam_member.observation_scheduler]
}
