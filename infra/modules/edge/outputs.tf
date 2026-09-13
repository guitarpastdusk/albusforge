output "ip_address" {
  value = google_compute_global_address.lb.address
}

output "https_url_map" {
  description = "Extend with path matchers for ingest (M6) and media (M7)."
  value       = google_compute_url_map.https.id
}

output "security_policy" {
  value = google_compute_security_policy.edge.id
}
