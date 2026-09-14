mock_provider "google" {}
mock_provider "random" {}
override_data {
  target = data.terraform_remote_state.bootstrap
  values = {
    outputs = {
      project_ids = { staging = "test-staging", prod = "test-prod" }
      env_domains = { staging = "staging.example.com", prod = "example.com" }
      dns_zones   = { staging = "staging", prod = "prod" }
    }
  }
}
variables {
  tfstate_bucket = "unused-mocked-state"
  alert_email    = "ops@example.com"
}
run "private_media_and_disabled_activation" {
  command = plan
  assert {
    condition     = google_storage_bucket.observations.uniform_bucket_level_access && google_storage_bucket.observations.public_access_prevention == "enforced" && !google_storage_bucket.observations.force_destroy
    error_message = "Media bucket must remain private with protected deletion."
  }
  assert {
    condition     = google_storage_bucket.observations.soft_delete_policy[0].retention_duration_seconds == 604800 && !google_storage_bucket.observations.versioning[0].enabled
    error_message = "Explicit seven-day soft delete without object versioning is required."
  }
  assert {
    condition     = !var.observation_uploads_enabled && !var.observation_reads_enabled && google_cloud_scheduler_job.observation_maintain.paused
    error_message = "Provisioning infrastructure must not activate uploads, reads or cleanup."
  }
  assert {
    condition     = toset(local.observation_permissions.writer) == toset(["storage.objects.create", "storage.objects.get"]) && toset(local.observation_permissions.reader) == toset(["storage.objects.get"]) && toset(local.observation_permissions.maintainer) == toset(["storage.objects.get", "storage.objects.list", "storage.objects.delete"])
    error_message = "Keep bucket writer, reader and cleanup permissions separate and minimal."
  }
  assert {
    condition     = google_cloud_scheduler_job.observation_maintain.schedule == "17 * * * *" && length(google_cloud_scheduler_job.observation_maintain.http_target[0].oauth_token) == 1
    error_message = "Maintenance runs hourly via OAuth, independent of the device's 15-minute timer."
  }
}

run "operational_metrics_disabled_until_activation" {
  command = plan
  assert {
    condition     = !google_monitoring_alert_policy.observation_upload_rejections.enabled && alltrue([for alert in google_monitoring_alert_policy.observation_health : !alert.enabled]) && !google_monitoring_alert_policy.observation_failures.enabled
    error_message = "Upload and maintenance operational alerts must remain disabled until their feature or schedule activation."
  }
  assert {
    condition     = toset(keys(google_logging_metric.observation_uploads.label_extractors)) == toset(["outcome", "reason"]) && alltrue([for metric in google_logging_metric.observation_health : length(coalesce(metric.label_extractors, {})) == 0])
    error_message = "Image metrics must never label device, tenant, observation, object key, or credential."
  }
  assert {
    condition     = strcontains(google_logging_metric.observation_health["camera_stale_count"].filter, "camera_scan_complete=true") && google_monitoring_alert_policy.observation_health["camera_stale_count"].conditions[0].condition_threshold[0].evaluation_missing_data == "EVALUATION_MISSING_DATA_NO_OP"
    error_message = "Partial camera scans cannot clear a completed stale result."
  }
  assert {
    condition     = alltrue([for alert in google_monitoring_alert_policy.observation_health : alert.conditions[0].condition_threshold[0].aggregations[0].per_series_aligner == "ALIGN_SUM" && alert.conditions[0].condition_threshold[0].aggregations[0].cross_series_reducer == "REDUCE_MEAN"])
    error_message = "Health thresholds use exact distribution means, not interpolated bucket percentiles that can turn zero stale cameras into a positive value."
  }
}
run "operational_metrics_follow_activation" {
  command = plan
  variables {
    observation_uploads_enabled  = true
    observation_schedule_enabled = true
  }
  assert {
    condition     = google_monitoring_alert_policy.observation_upload_rejections.enabled && alltrue([for alert in google_monitoring_alert_policy.observation_health : alert.enabled]) && google_monitoring_alert_policy.observation_failures.enabled
    error_message = "Approved feature/schedule activation must enable the matching operational alerts."
  }
}
