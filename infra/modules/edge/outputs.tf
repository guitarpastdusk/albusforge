output "ip_address" {
  value = google_compute_global_address.lb.address
}

output "https_url_map" {
  description = "Extend with rules for ingest (M6) and media (M7)."
  value       = google_compute_url_map.https.id
}

output "backend_services" {
  value = { for k, b in google_compute_backend_service.service : k => b.id }
}

output "security_policy" {
  value = google_compute_security_policy.edge.id
}
