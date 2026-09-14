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
run "firmware_inert_private_and_bounded" {
  command = plan
  assert {
    condition     = !var.firmware_builds_enabled && length(var.camera_plan_approvals) == 0 && google_cloud_scheduler_job.fwbuild.paused && !contains(keys(local.firmware_gateway_env), "FIRMWARE_JOB_RESOURCE")
    error_message = "Provisioning must not enable cloud compilation or approve hardware."
  }
  assert {
    condition     = local.firmware_gateway_env.FIRMWARE_DISPATCH_MODE == "scheduler" && google_cloud_scheduler_job.fwbuild.schedule == "*/15 * * * *"
    error_message = "Gateway must queue rather than dispatch unbounded Cloud Run executions."
  }
  assert {
    condition     = google_storage_bucket.firmware_artifacts.uniform_bucket_level_access && google_storage_bucket.firmware_artifacts.public_access_prevention == "enforced" && !google_storage_bucket.firmware_artifacts.force_destroy && length(google_storage_bucket.firmware_artifacts.lifecycle_rule) == 0
    error_message = "Firmware downloads must remain private and cannot silently expire."
  }
  assert {
    condition     = toset(local.firmware_object_permissions.writer) == toset(["storage.objects.create", "storage.objects.get"]) && toset(local.firmware_object_permissions.reader) == toset(["storage.objects.get"])
    error_message = "Compiler cannot overwrite/delete artifacts; gateway only reads."
  }
}
run "firmware_activation_is_explicit" {
  command = plan
  variables { firmware_builds_enabled = true }
  assert {
    condition     = !google_cloud_scheduler_job.fwbuild.paused && contains(keys(local.firmware_gateway_env), "FIRMWARE_JOB_RESOURCE") && length(var.camera_plan_approvals) == 0
    error_message = "Enabling the worker must not invent camera approval evidence."
  }
}
run "reject_unpinned_camera_approval" {
  command = plan
  variables {
    camera_plan_approvals = [{ candidate_id = "unknown", assembly_profile = { id = "draft", version = "1" }, part_versions = [], evidence_sha256 = "invalid", wiring_sha256 = "invalid" }]
  }
  expect_failures = [var.camera_plan_approvals]
}
