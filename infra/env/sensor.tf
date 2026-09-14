# Runtime and rollout contract: docs/SENSOR-INFRA.md. No automatic activation.
module "cloudlink" {
  source              = "../modules/run_service"
  project_id          = local.project_id
  region              = var.region
  name                = "cloudlink"
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  public_invoker      = true
  min_instances       = local.env == "prod" ? 1 : 0
  max_instances       = local.settings.sensor_max_instances
  request_concurrency = local.settings.cloudlink_concurrency
  request_timeout     = "60s"
  deletion_protection = local.settings.deletion_protection
  env = merge(local.db_env, {
    DB_USER                         = local.db_app_role
    DB_POOL_MAX                     = tostring(local.settings.cloudlink_pool_max)
    INGEST_MAX_INFLIGHT             = tostring(local.settings.cloudlink_concurrency)
    DB_CONNECT_TIMEOUT_MS           = "5000"
    DB_QUERY_TIMEOUT_MS             = "10000"
    DB_IDLE_TIMEOUT_MS              = "30000"
    GOOGLE_CLOUD_PROJECT            = local.project_id
    OBSERVATION_UPLOADS_ENABLED     = var.observation_uploads_enabled ? "1" : "0"
    CAMERA_IMAGES_BUCKET            = google_storage_bucket.observations.name
    OBSERVATION_STORAGE_WORKER_PATH = "/app/storage-worker.cjs"
  })
  secret_env = { DB_PASSWORD = { secret = module.sql.app_password_secret } }
}

locals {
  ask_env = merge(local.db_env, {
    DB_USER                   = local.db_app_role
    DB_POOL_MAX               = tostring(local.settings.ask_pool_max)
    ASK_MAX_CONCURRENCY       = tostring(local.settings.ask_pool_max)
    ASK_DEADLINE_MS           = "20000"
    ASK_MAX_OUTPUT_TOKENS     = "512"
    ASK_USER_DAILY_REQUESTS   = "20"
    ASK_TENANT_DAILY_REQUESTS = "100"
    ASK_GLOBAL_DAILY_REQUESTS = "200"
    ASK_MODEL_ENABLED         = tostring(var.ask_model_enabled)
    LLM_PROVIDER              = "anthropic"
    GOOGLE_CLOUD_PROJECT      = local.project_id
  }, var.ask_model_enabled ? { LLM_MODEL = var.ask_model } : {})
}

module "ask" {
  source              = "../modules/run_service"
  project_id          = local.project_id
  region              = var.region
  name                = "ask"
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  public_invoker      = false
  min_instances       = 0
  max_instances       = local.settings.sensor_max_instances
  request_concurrency = local.settings.ask_pool_max
  request_timeout     = "30s"
  deletion_protection = local.settings.deletion_protection
  env                 = local.ask_env
  secret_env = merge({ DB_PASSWORD = { secret = module.sql.app_password_secret } }, var.ask_model_enabled ? {
    ANTHROPIC_API_KEY = { secret = google_secret_manager_secret.external["anthropic-api-key"].id }
  } : {})
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invokes_ask" {
  project  = local.project_id
  location = var.region
  name     = module.ask.name
  role     = "roles/run.invoker"
  member   = module.gateway.service_account_member
}

locals {
  telemetry_jobs = {
    telemetry-rollup   = { schedule = "* * * * *", owner = false }
    telemetry-maintain = { schedule = "5 0 * * *", owner = true }
  }
}

module "telemetry_jobs" {
  for_each            = local.telemetry_jobs
  source              = "../modules/run_job"
  project_id          = local.project_id
  region              = var.region
  name                = each.key
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  timeout             = each.value.owner ? "600s" : local.settings.rollup_timeout
  max_retries         = local.settings.telemetry_max_retries
  deletion_protection = local.settings.deletion_protection
  env = merge(local.db_env, {
    DB_USER                = each.value.owner ? module.sql.migrate_user : local.db_app_role
    TELEMETRY_ROLLUP_LIMIT = "64"
  })
  secret_env = { DB_PASSWORD = { secret = each.value.owner ? module.sql.migrate_password_secret : module.sql.app_password_secret } }
}

resource "google_service_account" "telemetry_scheduler" {
  project      = local.project_id
  account_id   = "telemetry-scheduler"
  display_name = "Start telemetry jobs only"
}

resource "google_cloud_run_v2_job_iam_member" "telemetry_scheduler" {
  for_each = local.telemetry_jobs
  project  = local.project_id
  location = var.region
  name     = module.telemetry_jobs[each.key].name
  role     = "roles/run.invoker"
  member   = google_service_account.telemetry_scheduler.member
}

resource "google_cloud_scheduler_job" "telemetry" {
  for_each         = local.telemetry_jobs
  project          = local.project_id
  region           = var.region
  name             = each.key
  schedule         = each.value.schedule
  time_zone        = "Etc/UTC"
  paused           = !var.telemetry_schedules_enabled
  attempt_deadline = "30s"
  # Run API acceptance is asynchronous; execution failure alerts are separate.
  retry_config { retry_count = 0 }
  http_target {
    uri         = "https://run.googleapis.com/v2/projects/${local.project_id}/locations/${var.region}/jobs/${module.telemetry_jobs[each.key].name}:run"
    http_method = "POST"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.telemetry_scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
  depends_on = [google_cloud_run_v2_job_iam_member.telemetry_scheduler]
}
