# Sign-in codes are sent through Resend from auth.albusforge.ai (docs/adr/0008).
# The records live in the apex zone, which this root owns (docs/adr/0002). Values
# come from Resend's domain page; none of them are secret.

locals {
  resend_domain = "auth.${local.env_domains["prod"]}"

  # DKIM public key Resend generated for auth.albusforge.ai. Replacing the domain
  # in Resend issues a new key; update this and re-verify.
  resend_dkim = "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDBEN2gWwbq/HAbdjAtwQ7W80WpmcAMHaVLc8JivucUmhwMzrMlzSNxfq7a/B+1VNj6AAnGmZmuYTEcNjvKVp4Ng0XW8KwpnMCAdEl7ne4g867DwxzDkizuv05BF+KMbpG1ICFgFJTz24PRo0KmEd/7XWX793kDHNVH2WboML8tZQIDAQAB"

  email_records = {
    dkim = {
      name    = "resend._domainkey.${local.resend_domain}."
      type    = "TXT"
      rrdatas = ["\"${local.resend_dkim}\""]
    }
    # Resend's return-path and bounce handling (SPF passes through these).
    send = {
      name    = "send.${local.resend_domain}."
      type    = "CNAME"
      rrdatas = ["send.forge.rmta.net."]
    }
    rsend = {
      name    = "rsend.${local.resend_domain}."
      type    = "CNAME"
      rrdatas = ["rsend.forge.rmta.net."]
    }
    # Monitoring only for now: report, don't reject. Tighten to quarantine once
    # sign-in mail has been passing SPF and DKIM for a while.
    dmarc = {
      name    = "_dmarc.${local.env_domains["prod"]}."
      type    = "TXT"
      rrdatas = ["\"v=DMARC1; p=none;\""]
    }
  }
}

resource "google_dns_record_set" "email" {
  for_each = local.email_records

  project      = google_project.this["prod"].project_id
  managed_zone = google_dns_managed_zone.env["prod"].name
  name         = each.value.name
  type         = each.value.type
  ttl          = 300
  rrdatas      = each.value.rrdatas
}
