# GoDaddy stays registrar; its nameservers point at the prod zone. Staging owns
# its own subzone so an environment root only ever writes records in its own
# project. See docs/adr/0002-dns-cloud-dns-delegated-from-godaddy.md.
resource "google_dns_managed_zone" "env" {
  for_each = local.envs

  project     = google_project.this[each.key].project_id
  name        = replace(local.env_domains[each.key], ".", "-")
  dns_name    = "${local.env_domains[each.key]}."
  description = "Albus Forge ${each.key}"

  depends_on = [google_project_service.this]
}

resource "google_dns_record_set" "staging_delegation" {
  project      = google_project.this["prod"].project_id
  managed_zone = google_dns_managed_zone.env["prod"].name
  name         = google_dns_managed_zone.env["staging"].dns_name
  type         = "NS"
  ttl          = 3600
  rrdatas      = google_dns_managed_zone.env["staging"].name_servers
}
