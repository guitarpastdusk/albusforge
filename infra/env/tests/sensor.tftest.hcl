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

run "safe_initial_rollout" {
  command = plan
  assert {
    condition     = local.ask_env.ASK_MODEL_ENABLED == "false" && !contains(keys(local.ask_env), "LLM_MODEL")
    error_message = "Evidence-only Ask must omit LLM_MODEL, not send the invalid empty string."
  }
  assert {
    condition     = alltrue([for job in google_cloud_scheduler_job.telemetry : job.paused])
    error_message = "Initial schedules must remain paused until real images and migrations are validated."
  }
  assert {
    condition     = google_cloud_scheduler_job.telemetry["telemetry-rollup"].schedule == "* * * * *" && google_cloud_scheduler_job.telemetry["telemetry-maintain"].schedule == "5 0 * * *"
    error_message = "Rollup/maintenance must retain their minute/daily UTC cadence."
  }
  assert {
    condition     = alltrue([for job in google_cloud_scheduler_job.telemetry : length(job.http_target[0].oauth_token) == 1 && length(job.http_target[0].oidc_token) == 0])
    error_message = "Run API dispatch requires OAuth, not a service audience ID token."
  }
  assert {
    condition     = google_cloud_run_v2_service_iam_member.gateway_invokes_ask.role == "roles/run.invoker"
    error_message = "Gateway receives invocation only."
  }
}

run "narration_requires_model" {
  command = plan
  variables { ask_model_enabled = true }
  expect_failures = [var.ask_model]
}

run "narration_supported_model" {
  command = plan
  variables {
    ask_model_enabled = true
    ask_model         = "claude-haiku-4-5"
  }
  assert {
    condition     = local.ask_env.ASK_MODEL_ENABLED == "true" && local.ask_env.LLM_MODEL == "claude-haiku-4-5"
    error_message = "Enabled Ask must receive its supported explicit model."
  }
}

run "narration_rejects_unsupported_model" {
  command = plan
  variables {
    ask_model_enabled = true
    ask_model         = "claude-opus-5"
  }
  expect_failures = [var.ask_model]
}

run "observability_disabled_until_acceptance" {
  command = plan
  assert {
    condition     = !google_monitoring_alert_policy.telemetry_heartbeat.enabled && !google_monitoring_alert_policy.telemetry_maintenance_heartbeat.enabled && alltrue([for policy in google_monitoring_alert_policy.telemetry_backlog : !policy.enabled])
    error_message = "Do not page on paused initial processing."
  }
  assert {
    condition     = !google_monitoring_alert_policy.sensor_sql_connections.enabled
    error_message = "Connection alert needs a measured capacity threshold."
  }
  assert {
    condition     = length(jsondecode(google_monitoring_dashboard.sensor.dashboard_json).gridLayout.widgets) == 12
    error_message = "Expected ingestion, queue, SQL and execution evidence charts."
  }
}

run "observability_active_with_schedules" {
  command = plan
  variables {
    telemetry_schedules_enabled           = true
    sensor_sql_connection_alert_threshold = 65
  }
  assert {
    condition     = google_monitoring_alert_policy.telemetry_heartbeat.enabled && google_monitoring_alert_policy.telemetry_maintenance_heartbeat.enabled && alltrue([for policy in google_monitoring_alert_policy.telemetry_backlog : policy.enabled])
    error_message = "Processing alert policies must follow schedule activation."
  }
  assert {
    condition     = google_monitoring_alert_policy.sensor_sql_connections.enabled && google_monitoring_alert_policy.sensor_sql_connections.conditions[0].condition_threshold[0].threshold_value == 65
    error_message = "Apply only the explicitly reviewed connection ceiling."
  }
}

run "default_presence_is_exact_not_a_percentile" {
  command = plan
  assert {
    condition     = endswith(google_logging_metric.telemetry_default_present.filter, "AND jsonPayload.default_rows>0") && google_logging_metric.telemetry_default_present.metric_descriptor[0].value_type == "INT64"
    error_message = "Zero rows must be excluded before counting; default presence is not a distribution."
  }
  assert {
    condition     = endswith(google_monitoring_alert_policy.telemetry_backlog["default_rows"].conditions[0].condition_threshold[0].filter, "user/${google_logging_metric.telemetry_default_present.name}\"") && google_monitoring_alert_policy.telemetry_backlog["default_rows"].conditions[0].condition_threshold[0].aggregations[0].per_series_aligner == "ALIGN_SUM" && google_monitoring_alert_policy.telemetry_backlog["default_rows"].conditions[0].condition_threshold[0].threshold_value == 0
    error_message = "Default-row alert must test positive snapshot counts, not interpolated histogram buckets."
  }
}
