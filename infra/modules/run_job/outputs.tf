output "name" {
  value = google_cloud_run_v2_job.this.name
}

output "service_account_email" {
  value = google_service_account.runtime.email
}
