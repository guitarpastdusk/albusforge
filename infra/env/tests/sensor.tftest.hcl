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
