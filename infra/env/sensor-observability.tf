# Platform metrics catch failures even if a task exits before its logger starts.
resource "google_monitoring_alert_policy" "telemetry_failures" {
  for_each              = local.telemetry_jobs
  project               = local.project_id
  display_name          = "${each.key} failed (${local.env})"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "A telemetry job execution failed"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${each.key}\" AND metric.type=\"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result=\"failed\""
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
    content   = "Inspect the failed execution and redacted logs; verify DB connectivity, migration version and lock contention. A successful Scheduler dispatch only starts a job. Pause schedules before incident retries; do not bypass dirty-hour retention guards. See docs/SENSOR-INFRA.md."
  }
}

resource "google_monitoring_alert_policy" "sensor_http_errors" {
  for_each              = toset(["cloudlink", "ask"])
  project               = local.project_id
  display_name          = "${each.key} server errors (${local.env})"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "Five server errors in five minutes"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${each.key}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 4
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}
