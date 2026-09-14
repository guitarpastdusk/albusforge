# Application SQL capture-time expiry is authoritative. Provider lifecycle is a
# delayed safety net measured from upload; it must not hide valid late uploads.
resource "google_storage_bucket" "observations" {
  project                     = local.project_id
  name                        = "${local.project_id}-observations"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = { purpose = "sensor-observations", environment = local.env }
  versioning { enabled = false }
  soft_delete_policy { retention_duration_seconds = 604800 }
  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 31 }
  }
}

locals {
  observation_permissions = {
    writer     = ["storage.objects.create", "storage.objects.get"]
    reader     = ["storage.objects.get"]
    maintainer = ["storage.objects.get", "storage.objects.list", "storage.objects.delete"]
  }
  observation_members = {
    writer     = module.cloudlink.service_account_member
    reader     = module.gateway.service_account_member
    maintainer = "serviceAccount:${module.observation_maintain.service_account_email}"
  }
}

resource "google_project_iam_custom_role" "observation_objects" {
  for_each    = local.observation_permissions
  project     = local.project_id
  role_id     = "observation_${each.key}"
  title       = "Observation objects ${each.key}"
  permissions = each.value
}

resource "google_storage_bucket_iam_member" "observations" {
  for_each = local.observation_permissions
  bucket   = google_storage_bucket.observations.name
  role     = google_project_iam_custom_role.observation_objects[each.key].name
  member   = local.observation_members[each.key]
}
