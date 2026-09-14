# Compiler infrastructure is provisioned inert; CI owns the deployed image.
variable "firmware_builds_enabled" {
  description = "Enable queued cloud builds and quarter-hour recovery only after reviewed runtime deployment and capacity acceptance."
  type        = bool
  default     = false
}
variable "camera_plan_approvals" {
  description = "Reviewed immutable physical evidence pins, shared by gateway and compiler. Empty until explicit hardware approval."
  type = list(object({
    candidate_id     = string
    assembly_profile = object({ id = string, version = string })
    part_versions    = list(object({ id = string, version = string }))
    evidence_sha256  = string
    wiring_sha256    = string
  }))
  default = []
  validation {
    condition = length(var.camera_plan_approvals) <= 32 && length(jsonencode(var.camera_plan_approvals)) <= 65536 && length(toset([for approval in var.camera_plan_approvals : "${approval.assembly_profile.id}@${approval.assembly_profile.version}"])) == length(var.camera_plan_approvals) && alltrue([
      for approval in var.camera_plan_approvals :
      approval.candidate_id == "freenove-esp32s3-n16r8-gc0308-usb-v1" &&
      can(regex("^[a-f0-9]{64}$", approval.evidence_sha256)) &&
      can(regex("^[a-f0-9]{64}$", approval.wiring_sha256)) &&
      length(approval.part_versions) > 0 && length(approval.part_versions) <= 64
    ])
    error_message = "Camera approvals must pin the fixed native candidate and reviewed evidence/wiring digests."
  }
}
resource "google_storage_bucket" "firmware_artifacts" {
  project                     = local.project_id
  name                        = "${local.project_id}-firmware-artifacts"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = { purpose = "firmware-artifacts", environment = local.env }
  versioning { enabled = false }
  soft_delete_policy { retention_duration_seconds = 604800 }
  # Verified historical downloads have no automatic expiry in the API. Do not
  # silently invalidate passed build references with an upload-age lifecycle.
}
module "fwbuild" {
  source              = "../modules/run_job"
  project_id          = local.project_id
  region              = var.region
  name                = "fwbuild"
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  cpu                 = "2"
  memory              = "4Gi"
  timeout             = "840s"
  max_retries         = 0
  deletion_protection = local.settings.deletion_protection
  env = merge(local.db_env, {
    DB_USER                      = local.db_app_role
    DB_POOL_MAX                  = "2"
    FIRMWARE_ARTIFACT_BUCKET     = google_storage_bucket.firmware_artifacts.name
    FIRMWARE_COMPILER_MODE       = "idf"
    FIRMWARE_TEMPLATE_DIR        = "/app/firmware/esp32s3"
    FIRMWARE_CAMERA_TEMPLATE_DIR = "/app/firmware/esp32s3-camera"
    CAMERA_PLAN_APPROVALS        = jsonencode(var.camera_plan_approvals)
    GOOGLE_CLOUD_PROJECT         = local.project_id
  })
  secret_env = { DB_PASSWORD = { secret = module.sql.app_password_secret } }
}
locals {
  firmware_gateway_env = merge({
    FIRMWARE_ARTIFACT_BUCKET = google_storage_bucket.firmware_artifacts.name
    FIRMWARE_DISPATCH_MODE   = "scheduler"
    CAMERA_PLAN_APPROVALS    = jsonencode(var.camera_plan_approvals)
    }, var.firmware_builds_enabled ? {
    FIRMWARE_JOB_RESOURCE = "projects/${local.project_id}/locations/${var.region}/jobs/${module.fwbuild.name}"
  } : {})
  firmware_object_permissions = {
    writer = ["storage.objects.create", "storage.objects.get"]
    reader = ["storage.objects.get"]
  }
  firmware_object_members = {
    writer = "serviceAccount:${module.fwbuild.service_account_email}"
    reader = module.gateway.service_account_member
  }
}
resource "google_project_iam_custom_role" "firmware_objects" {
  for_each    = local.firmware_object_permissions
  project     = local.project_id
  role_id     = "firmware_artifacts_${each.key}"
  title       = "Firmware artifacts ${each.key}"
  permissions = each.value
}
resource "google_storage_bucket_iam_member" "firmware_artifacts" {
  for_each = local.firmware_object_permissions
  bucket   = google_storage_bucket.firmware_artifacts.name
  role     = google_project_iam_custom_role.firmware_objects[each.key].name
  member   = local.firmware_object_members[each.key]
}
# Gateway only queues work in SQL. It cannot create Cloud Run executions.
resource "google_cloud_run_v2_job_iam_member" "firmware_scheduler" {
  project  = local.project_id
  location = var.region
  name     = module.fwbuild.name
  role     = "roles/run.invoker"
  member   = google_service_account.telemetry_scheduler.member
}
resource "google_cloud_scheduler_job" "fwbuild" {
  project          = local.project_id
  region           = var.region
  name             = "fwbuild"
  schedule         = "*/15 * * * *"
  time_zone        = "Etc/UTC"
  paused           = !var.firmware_builds_enabled
  attempt_deadline = "30s"
  retry_config { retry_count = 0 }
  http_target {
    uri         = "https://run.googleapis.com/v2/projects/${local.project_id}/locations/${var.region}/jobs/${module.fwbuild.name}:run"
    http_method = "POST"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.telemetry_scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
  depends_on = [google_cloud_run_v2_job_iam_member.firmware_scheduler]
}
output "firmware_build" {
  value = {
    job            = module.fwbuild.name
    bucket         = google_storage_bucket.firmware_artifacts.name
    enabled        = var.firmware_builds_enabled
    approval_count = length(var.camera_plan_approvals)
  }
}
