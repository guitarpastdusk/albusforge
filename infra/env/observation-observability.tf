resource "google_logging_metric" "observation_maintenance_heartbeat" {
  project = local.project_id
  name    = "observation_maintenance_heartbeat"
  filter  = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"observation-maintain\" AND jsonPayload.event=\"observation_maintenance\" AND jsonPayload.errors=0 AND jsonPayload.busy=false"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "observation_maintenance_heartbeat" {
  project               = local.project_id
  display_name          = "Observation maintenance heartbeat absent (${local.env})"
  enabled               = var.observation_schedule_enabled
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "No successful maintenance for three hours"
    condition_absent {
      filter   = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.observation_maintenance_heartbeat.name}\""
      duration = "10800s"
      aggregations {
        alignment_period     = "3600s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Require a successful manual seed execution and visible heartbeat before schedule activation. Inspect per-item errors, deferred work, lease contention and SQL/object deletion backlog. Scheduler dispatch success alone is insufficient."
  }
}

resource "google_monitoring_alert_policy" "observation_failures" {
  project               = local.project_id
  display_name          = "Observation maintenance failed (${local.env})"
  enabled               = var.observation_schedule_enabled
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "A maintenance execution failed"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"observation-maintain\" AND metric.type=\"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result=\"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "observation_storage_budget" {
  project               = local.project_id
  display_name          = "Observation bucket byte budget (${local.env})"
  combiner              = "OR"
  enabled               = var.observation_uploads_enabled
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "Stored bytes exceed reviewed capacity budget"
    condition_threshold {
      filter          = "resource.type=\"gcs_bucket\" AND resource.labels.bucket_name=\"${google_storage_bucket.observations.name}\" AND metric.type=\"storage.googleapis.com/storage/v2/total_bytes\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.observation_storage_budget_bytes
      duration        = "0s"
      aggregations {
        alignment_period     = "86400s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Capacity metric is delayed and is not a spending cap. Inspect live and soft-deleted bytes, operations and maintenance backlog. Logical media expiry is 30 days from capture; soft delete retains deleted bytes for 7 additional days. Pause uploads if needed; do not disable expiry."
  }
}
