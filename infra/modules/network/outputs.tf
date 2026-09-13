output "network_id" {
  value = google_compute_network.this.id
}

output "network_name" {
  value = google_compute_network.this.name
}

output "subnet_id" {
  value = google_compute_subnetwork.this.id
}

output "psa_connection" {
  description = "Depend on this from Cloud SQL and Memorystore."
  value       = google_service_networking_connection.psa.id
}
