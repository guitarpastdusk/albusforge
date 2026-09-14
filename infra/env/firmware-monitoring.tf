resource "google_logging_metric" "firmware_build_failed" {
  project = local.project_id
  name    = "firmware_build_failed"
  filter  = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"fwbuild\" AND jsonPayload.event=\"firmware_build\" AND jsonPayload.outcome=\"failed\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}
resource "google_monitoring_alert_policy" "firmware_failures" {
  project               = local.project_id
  display_name          = "Firmware worker or compilation failed (${local.env})"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "A worker execution failed"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"fwbuild\" AND metric.type=\"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result=\"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  conditions {
    display_name = "An admitted compilation failed"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.firmware_build_failed.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Inspect the authorized build's bounded diagnostics. A successfully completed Cloud Run execution can contain a rejected or failed compilation; neither job success nor an idle queue certifies a passed firmware artifact. Preserve immutable artifact references and accepted-plan authorization."
  }
}
resource "google_monitoring_alert_policy" "firmware_artifact_capacity" {
  project               = local.project_id
  display_name          = "Firmware artifact bucket exceeds 1 GiB (${local.env})"
  enabled               = var.firmware_builds_enabled
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "Stored artifacts exceed initial capacity allowance"
    condition_threshold {
      filter          = "resource.type=\"gcs_bucket\" AND resource.labels.bucket_name=\"${google_storage_bucket.firmware_artifacts.name}\" AND metric.type=\"storage.googleapis.com/storage/v2/total_bytes\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1073741824
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
    content   = "Delayed capacity signal including soft-deleted bytes, not a spending cap. Pause build admission and review historical artifact references before any cleanup. No automatic expiry is configured for verified downloads."
  }
}
