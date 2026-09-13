locals {
  hostnames = var.include_wildcard ? [var.domain, "*.${var.domain}"] : [var.domain]
}

resource "google_compute_global_address" "lb" {
  project = var.project_id
  name    = "${var.name}-lb"
}

# --- certificate ------------------------------------------------------------

resource "google_certificate_manager_dns_authorization" "this" {
  project = var.project_id
  name    = "${var.name}-dnsauth"
  domain  = var.domain
}

resource "google_dns_record_set" "acme" {
  project      = var.project_id
  managed_zone = var.dns_zone
  name         = google_certificate_manager_dns_authorization.this.dns_resource_record[0].name
  type         = google_certificate_manager_dns_authorization.this.dns_resource_record[0].type
  ttl          = 300
  rrdatas      = [google_certificate_manager_dns_authorization.this.dns_resource_record[0].data]
}

resource "google_certificate_manager_certificate" "this" {
  project = var.project_id
  name    = "${var.name}-cert"

  managed {
    domains            = local.hostnames
    dns_authorizations = [google_certificate_manager_dns_authorization.this.id]
  }
}

resource "google_certificate_manager_certificate_map" "this" {
  project = var.project_id
  name    = "${var.name}-certmap"
}

resource "google_certificate_manager_certificate_map_entry" "primary" {
  project      = var.project_id
  name         = "${var.name}-primary"
  map          = google_certificate_manager_certificate_map.this.name
  certificates = [google_certificate_manager_certificate.this.id]
  matcher      = "PRIMARY"
}

# --- backends ---------------------------------------------------------------

resource "google_compute_region_network_endpoint_group" "service" {
  for_each = var.services

  project               = var.project_id
  name                  = "${var.name}-${each.key}"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = each.value
  }
}

resource "google_compute_security_policy" "edge" {
  project = var.project_id
  name    = "${var.name}-edge"
  type    = "CLOUD_ARMOR"

  rule {
    description = "Per-IP throttle"
    priority    = 1000
    action      = "throttle"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = var.rate_limit_count
        interval_sec = var.rate_limit_interval_sec
      }
    }
  }

  rule {
    description = "Default allow"
    priority    = 2147483647
    action      = "allow"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

# No CDN on these: gateway serves SSE, which a cache would buffer. Static web
# assets get CDN through a backend bucket when that lands.
resource "google_compute_backend_service" "service" {
  for_each = var.services

  project               = var.project_id
  name                  = "${var.name}-${each.key}"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = lookup(var.backend_security_policies, each.key, google_compute_security_policy.edge.id)

  backend {
    group = google_compute_region_network_endpoint_group.service[each.key].id
  }

  log_config {
    enable      = !contains(var.disable_request_logging, each.key)
    sample_rate = 1.0
  }
}

# --- frontend ---------------------------------------------------------------

# One path matcher for every hostname — apex and tenant subdomains route
# identically; the app tells them apart by Host header. See docs/adr/0007.
resource "google_compute_url_map" "https" {
  project         = var.project_id
  name            = "${var.name}-https"
  default_service = google_compute_backend_service.service[var.default_backend].id

  # A browser must never be able to send headers that backends trust from
  # internal callers. The backend's own verification is the real control.
  dynamic "header_action" {
    for_each = length(var.strip_request_headers) > 0 ? [1] : []
    content {
      request_headers_to_remove = var.strip_request_headers
    }
  }

  host_rule {
    hosts        = ["*"]
    path_matcher = "all-hosts"
  }

  path_matcher {
    name            = "all-hosts"
    default_service = google_compute_backend_service.service[var.default_backend].id

    dynamic "path_rule" {
      for_each = var.path_rules
      content {
        paths   = path_rule.value.paths
        service = google_compute_backend_service.service[path_rule.value.backend].id
      }
    }
  }
}

resource "google_compute_target_https_proxy" "this" {
  project         = var.project_id
  name            = "${var.name}-https"
  url_map         = google_compute_url_map.https.id
  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.this.id}"

  depends_on = [google_certificate_manager_certificate_map_entry.primary]
}

resource "google_compute_global_forwarding_rule" "https" {
  project               = var.project_id
  name                  = "${var.name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb.address
  port_range            = "443"
  target                = google_compute_target_https_proxy.this.id
}

resource "google_compute_url_map" "redirect" {
  project = var.project_id
  name    = "${var.name}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  project = var.project_id
  name    = "${var.name}-http-redirect"
  url_map = google_compute_url_map.redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  project               = var.project_id
  name                  = "${var.name}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb.address
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect.id
}

# --- dns --------------------------------------------------------------------

resource "google_dns_record_set" "a" {
  for_each = toset(local.hostnames)

  project      = var.project_id
  managed_zone = var.dns_zone
  name         = "${each.value}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb.address]
}
