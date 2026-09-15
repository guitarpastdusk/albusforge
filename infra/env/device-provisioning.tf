# Secret value is seeded outside Terraform; no encryption key enters state.
variable "device_provisioning_enabled" {
  description = "Mount the seeded handoff keyring and enable approved-profile device handoff only after review."
  type        = bool
  default     = false
  validation {
    condition     = !var.device_provisioning_enabled || can(regex("^[1-9][0-9]*$", var.device_handoff_key_version))
    error_message = "Enable handoff only with an explicitly seeded numeric Secret Manager version."
  }
}
variable "device_handoff_key_version" {
  description = "Nonsecret seeded keyring version; changing it creates a reviewed gateway revision for rotation."
  type        = string
  default     = ""
}
resource "google_secret_manager_secret" "device_handoff_keys" {
  project   = local.project_id
  secret_id = "device-handoff-keys"
  replication {
    auto {}
  }
}
locals {
  device_provisioning_env = var.device_provisioning_enabled ? {
    DEVICE_INGEST_URL = "https://${local.domain}/ingest/v1"
  } : {}
  device_provisioning_secrets = var.device_provisioning_enabled ? {
    DEVICE_HANDOFF_KEYS = { secret = google_secret_manager_secret.device_handoff_keys.id, version = var.device_handoff_key_version }
  } : {}
}
