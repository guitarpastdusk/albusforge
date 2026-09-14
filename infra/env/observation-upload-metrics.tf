# Bounded label space: application emits fixed outcomes/reasons, never identity.
resource "google_logging_metric" "observation_uploads" {
  project = local.project_id
  name    = "observation_uploads"
  filter  = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"cloudlink\" AND jsonPayload.event=\"observation_upload\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key        = "outcome"
      value_type = "STRING"
    }
    labels {
      key        = "reason"
      value_type = "STRING"
    }
  }
  label_extractors = { outcome = "EXTRACT(jsonPayload.outcome)", reason = "EXTRACT(jsonPayload.reason)" }
}

locals {
  observation_upload_distributions = {
    accepted_bytes = { field = "accepted_bytes", unit = "By", event = "observation_accepted", scale = 1024 }
    request_ms     = { field = "request_ms", unit = "ms", event = "observation_upload", scale = 1 }
    storage_ms     = { field = "storage_ms", unit = "ms", event = "observation_upload", scale = 1 }
  }
  observation_health_distributions = {
    camera_scan_age_s            = { unit = "s", threshold = 10800, doc = "The bounded camera sweep is more than three hours old. Staleness totals are incomplete until wrap; review fleet size, page limit and schedule capacity rather than treating partial pages as healthy." }
    deletion_backlog_lower_bound = { unit = "1", threshold = 100, doc = "Deletion backlog exceeds one maintenance batch. Count is capped and is a lower bound; inspect oldest age and per-item errors." }
    deletion_oldest_age_s        = { unit = "s", threshold = 10800, doc = "Deletion work is older than three hours. Preserve durable intents and inspect SQL/object errors; do not bypass object-generation fences." }
    reservation_overdue_age_s    = { unit = "s", threshold = 7200, doc = "Oldest reserved upload lease is more than two hours overdue. Inspect lost storage/SQL acknowledgements and maintenance recovery." }
    camera_stale_count           = { unit = "1", threshold = 0, doc = "A completed camera scan found enabled, nonrevoked cameras with stale capture or receive times after startup grace. Threshold is 2*configured cadence+300s (35 minutes at 900s); notification is delayed by hourly scheduling and bounded multi-page scans. Partial pages cannot clear this alert." }
  }
}
resource "google_logging_metric" "observation_upload_values" {
  for_each        = local.observation_upload_distributions
  project         = local.project_id
  name            = "observation_${each.key}"
  filter          = "((resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"cloudlink\")${each.key == "accepted_bytes" ? " OR (resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"observation-maintain\")" : ""}) AND jsonPayload.event=\"${each.value.event}\""
  value_extractor = "EXTRACT(jsonPayload.${each.value.field})"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = each.value.unit
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 24
      growth_factor      = 2
      scale              = each.value.scale
    }
  }
}
resource "google_monitoring_alert_policy" "observation_upload_rejections" {
  project               = local.project_id
  display_name          = "Observation upload rejections (${local.env})"
  enabled               = var.observation_uploads_enabled
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "At least six image rejections in five minutes"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.observation_uploads.name}\" AND metric.labels.outcome=\"rejected\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Inspect bounded reason labels: authentication/configuration errors, validation, quota, pending leases, storage failures or client disconnects. These are operational request counts; SQL observation_usage remains authoritative for accepted images/bytes across ambiguous commits."
  }
}
resource "google_logging_metric" "observation_health" {
  for_each        = local.observation_health_distributions
  project         = local.project_id
  name            = "observation_${each.key}"
  filter          = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"observation-maintain\" AND jsonPayload.event=\"observation_health\" AND jsonPayload.${each.key}:*${each.key == "camera_stale_count" ? " AND jsonPayload.camera_scan_complete=true" : ""}"
  value_extractor = "EXTRACT(jsonPayload.${each.key})"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = each.value.unit
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 32
      growth_factor      = 2
      scale              = 1
    }
  }
}
resource "google_monitoring_alert_policy" "observation_health" {
  for_each              = local.observation_health_distributions
  project               = local.project_id
  display_name          = "Observation ${replace(each.key, "_", " ")} (${local.env})"
  enabled               = var.observation_schedule_enabled
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "Completed health sample breaches operational threshold"
    condition_threshold {
      filter                  = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.observation_health[each.key].name}\""
      comparison              = "COMPARISON_GT"
      threshold_value         = each.value.threshold
      duration                = "60s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_NO_OP"
      aggregations {
        alignment_period     = "3600s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_MEAN"
      }
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "${each.value.doc} Missing samples do not clear incidents; the separate maintenance heartbeat detects stalled execution. Enable only after the new migration/runtime and a verified manual seed sweep are deployed."
  }
}
