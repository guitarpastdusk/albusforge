output "name" {
  value = google_cloud_run_v2_service.this.name
}

output "id" {
  value = google_cloud_run_v2_service.this.id
}

output "uri" {
  value = google_cloud_run_v2_service.this.uri
}

output "service_account_email" {
  value = google_service_account.runtime.email
}

output "service_account_member" {
  description = "For run.invoker bindings on the services this one calls."
  value       = google_service_account.runtime.member
}
