output "project_ids" {
  value = { for k, p in google_project.this : k => p.project_id }
}

output "project_numbers" {
  value = { for k, p in google_project.this : k => p.number }
}

output "tfstate_bucket" {
  value = google_storage_bucket.tfstate.name
}

output "artifact_registry" {
  description = "Image path prefix: <this>/<app>:<sha>"
  value       = "${google_artifact_registry_repository.images.location}-docker.pkg.dev/${google_artifact_registry_repository.images.project}/${google_artifact_registry_repository.images.repository_id}"
}

output "env_domains" {
  value = local.env_domains
}

output "dns_zones" {
  description = "Managed zone name per environment, in that environment's project."
  value       = { for k, z in google_dns_managed_zone.env : k => z.name }
}

output "prod_name_servers" {
  description = "Enter these as custom nameservers at GoDaddy."
  value       = google_dns_managed_zone.env["prod"].name_servers
}

output "github_actions" {
  description = "Inputs for google-github-actions/auth, per GitHub environment."
  value = {
    workload_identity_provider = google_iam_workload_identity_pool_provider.github.name
    service_accounts           = { for k, sa in google_service_account.deployer : k => sa.email }
  }
}
