mock_provider "google" {}
variables {
  project_id = "test-project"
  region     = "us-central1"
  name       = "ask"
  network    = "test-network"
  subnetwork = "test-subnetwork"
}
run "private_bounded_service" {
  command = plan
  variables {
    max_instances       = 2
    request_concurrency = 4
    request_timeout     = "30s"
  }
  assert {
    condition     = length(google_cloud_run_v2_service_iam_member.public) == 0 && google_cloud_run_v2_service.this.ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY"
    error_message = "Internal services cannot acquire a public invoker by default."
  }
  assert {
    condition     = google_cloud_run_v2_service.this.template[0].max_instance_request_concurrency == 4 && google_cloud_run_v2_service.this.template[0].timeout == "30s" && google_cloud_run_v2_service.this.template[0].scaling[0].max_instance_count == 2
    error_message = "The runtime must enforce the requested admission and instance bounds."
  }
}
run "legacy_defaults" {
  command = plan
  assert {
    condition     = google_cloud_run_v2_service.this.template[0].max_instance_request_concurrency == 80 && google_cloud_run_v2_service.this.template[0].timeout == "300s"
    error_message = "Existing service callers retain platform timeout/concurrency defaults."
  }
}
