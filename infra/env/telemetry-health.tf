locals {
  telemetry_health_fields = {
    dirty_hours          = { unit = "1" }
    oldest_dirty_seconds = { unit = "s" }
    default_rows         = { unit = "1" }
  }
  # Exact log predicates determine breaches; distribution buckets are visualization only.
  telemetry_breach_predicates = {
    dirty_hours          = "jsonPayload.dirty_hours>10000"
    oldest_dirty_seconds = "jsonPayload.oldest_dirty_seconds>900"
    default_rows         = "jsonPayload.default_rows>0"
  }
  sql_health_metrics = {
    cpu  = { metric = "cpu/utilization", threshold = 0.8 }
    disk = { metric = "disk/utilization", threshold = 0.8 }
  }
}

# Bounded-cardinality operational snapshots; no device, tenant, token or payload labels.
resource "google_logging_metric" "telemetry_health" {
  for_each = local.telemetry_health_fields
  project  = local.project_id
  name     = "telemetry_${each.key}"
  filter   = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"telemetry-rollup\" AND jsonPayload.event=\"telemetry_health\" AND jsonPayload.${each.key}:*"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = each.value.unit
  }
  value_extractor = "EXTRACT(jsonPayload.${each.key})"
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 32
      growth_factor      = 2
      scale              = 1
    }
  }
}

resource "google_logging_metric" "telemetry_heartbeat" {
  project = local.project_id
  name    = "telemetry_health_heartbeat"
  filter  = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"telemetry-rollup\" AND jsonPayload.event=\"telemetry_health\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

# Presence is categorical: zero must never become a positive histogram estimate.
# Keep the row-count distribution for charts, but alert on exact positive snapshots.
resource "google_logging_metric" "telemetry_default_present" {
  project = local.project_id
  name    = "telemetry_default_present"
  filter  = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"telemetry-rollup\" AND jsonPayload.event=\"telemetry_health\" AND ${local.telemetry_breach_predicates.default_rows}"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "telemetry_breach" {
  for_each = { for key, predicate in local.telemetry_breach_predicates : key => predicate if key != "default_rows" }
  project  = local.project_id
  name     = "telemetry_${each.key}_breach"
  filter   = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"telemetry-rollup\" AND jsonPayload.event=\"telemetry_health\" AND ${each.value}"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "telemetry_backlog" {
  for_each              = local.telemetry_health_fields
  project               = local.project_id
  display_name          = "Telemetry ${each.key} (${local.env})"
  enabled               = var.telemetry_schedules_enabled
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "Unhealthy post-rollup snapshot for ten minutes"
    condition_threshold {
      filter                  = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${each.key == "default_rows" ? google_logging_metric.telemetry_default_present.name : google_logging_metric.telemetry_breach[each.key].name}\""
      comparison              = "COMPARISON_GT"
      threshold_value         = 0
      duration                = "600s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Inspect telemetry job logs and queue age. Default rows can be valid backfill pending maintenance; inspect before changing retention. All queue/default/age decisions use exact breach counters; histograms are dashboard-only. At least one breach must remain in each five-minute alignment window for ten minutes; missing data is inactive. Do not delete dirty markers to silence alerts. See docs/SENSOR-OBSERVABILITY.md."
  }
}

resource "google_monitoring_alert_policy" "telemetry_heartbeat" {
  project               = local.project_id
  display_name          = "Telemetry rollup heartbeat absent (${local.env})"
  enabled               = var.telemetry_schedules_enabled
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "No successful rollup health snapshot for fifteen minutes"
    condition_absent {
      filter   = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.telemetry_heartbeat.name}\""
      duration = "900s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Check Scheduler, job execution status and telemetry_health logs. A successful dispatch is not completed processing. This absence detector must observe a point after enabling; initial rollout requires an explicit seed execution and visible point. Pause schedules and inspect SQL before retries. See docs/SENSOR-OBSERVABILITY.md."
  }
}

resource "google_monitoring_alert_policy" "sensor_sql_health" {
  for_each              = local.sql_health_metrics
  project               = local.project_id
  display_name          = "Shared sensor SQL ${each.key} saturation (${local.env})"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "Shared SQL utilization above 80 percent for ten minutes"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${local.project_id}:${module.sql.instance_name}\" AND metric.type=\"cloudsql.googleapis.com/database/${each.value.metric}\""
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = "600s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
}

variable "sensor_sql_connection_alert_threshold" {
  description = "Measured safe connection ceiling after reserves, not max_connections. Zero leaves the alert disabled until capacity review."
  type        = number
  default     = 0
  validation {
    condition     = var.sensor_sql_connection_alert_threshold >= 0 && floor(var.sensor_sql_connection_alert_threshold) == var.sensor_sql_connection_alert_threshold
    error_message = "Connection threshold must be a nonnegative integer."
  }
}

resource "google_monitoring_alert_policy" "sensor_sql_connections" {
  project               = local.project_id
  display_name          = "Shared sensor SQL connections (${local.env})"
  enabled               = var.sensor_sql_connection_alert_threshold > 0
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "Connections exceed the reviewed capacity ceiling"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${local.project_id}:${module.sql.instance_name}\" AND metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.sensor_sql_connection_alert_threshold
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Threshold comes from the recorded SQL capacity review and reserves; this is notification, not admission control. Check all application pools and overlapping revisions/job executions before increasing limits."
  }
}

resource "google_logging_metric" "telemetry_maintenance_heartbeat" {
  project = local.project_id
  name    = "telemetry_maintenance_heartbeat"
  filter  = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"telemetry-maintain\" AND jsonPayload.event=\"telemetry_health\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

# PromQL supports >25h lookback with a >=5-minute evaluation interval. Native
# metric-absence's 23.5-hour limit cannot monitor this daily cadence correctly.
resource "google_monitoring_alert_policy" "telemetry_maintenance_heartbeat" {
  project               = local.project_id
  display_name          = "Telemetry maintenance missing for 26 hours (${local.env})"
  enabled               = var.telemetry_schedules_enabled
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "No successful maintenance health snapshot in 26 hours"
    condition_prometheus_query_language {
      query                     = "(sum(sum_over_time({\"logging.googleapis.com/user/${google_logging_metric.telemetry_maintenance_heartbeat.name}\",monitored_resource=\"cloud_run_job\",job_name=\"telemetry-maintain\"}[26h])) <= 0) or absent_over_time({\"logging.googleapis.com/user/${google_logging_metric.telemetry_maintenance_heartbeat.name}\",monitored_resource=\"cloud_run_job\",job_name=\"telemetry-maintain\"}[26h])"
      duration                  = "0s"
      evaluation_interval       = "300s"
      disable_metric_validation = true
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Daily 00:05 UTC maintenance has no successful health event in 26h (2h grace). Logs-based counters can contain zero points, so absence alone is insufficient. Seed a real successful execution and verify metric visibility before enabling schedules/policy; a never-seen stream is unhealthy immediately after enabling. Inspect Scheduler and executions; never bypass dirty-hour retention guards."
  }
}

resource "google_logging_metric" "ingest_pool_wait" {
  project = local.project_id
  name    = "ingest_pool_wait_ms"
  filter  = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"cloudlink\" AND jsonPayload.event=\"ingest_pool_wait\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "ms"
    labels {
      key        = "outcome"
      value_type = "STRING"
    }
  }
  value_extractor  = "EXTRACT(jsonPayload.pool_wait_ms)"
  label_extractors = { outcome = "EXTRACT(jsonPayload.outcome)" }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 20
      growth_factor      = 2
      scale              = 0.1
    }
  }
}

resource "google_logging_metric" "ingest_pool_wait_breach" {
  project = local.project_id
  name    = "ingest_pool_wait_breach"
  filter  = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"cloudlink\" AND jsonPayload.event=\"ingest_pool_wait\" AND jsonPayload.pool_wait_ms>500"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "ingest_pool_wait" {
  project               = local.project_id
  display_name          = "Ingestion pool acquisition breaches above 500ms (${local.env})"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.spend.id]
  conditions {
    display_name = "Above-500ms acquisitions recur for five minutes"
    condition_threshold {
      filter                  = "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.ingest_pool_wait_breach.name}\""
      comparison              = "COMPARISON_GT"
      threshold_value         = 0
      duration                = "300s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "This alerts when at least one pool.connect duration strictly above 500ms occurs in each one-minute alignment window for five minutes; it is a recurring exact-breach policy, not a p95 policy. Missing data is inactive. Durations include queue, connection setup and failed acquisitions. Inspect SQL connections, CPU, active transactions and Cloud Run revisions. Do not raise pool/max-instance limits without rechecking shared capacity."
  }
}
