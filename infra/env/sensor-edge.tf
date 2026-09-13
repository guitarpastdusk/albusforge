resource "google_compute_security_policy" "cloudlink" {
  project = local.project_id
  name    = "${local.name}-cloudlink"
  type    = "CLOUD_ARMOR"
  # Malformed/missing credentials share a coarse per-IP allowance. Armor cannot
  # authenticate valid-looking tokens; SQL authentication remains authoritative.
  rule {
    priority = 100
    action   = "throttle"
    match {
      expr {
        expression = "!has(request.headers['authorization']) || !request.headers['authorization'].matches('^Bearer [A-Za-z0-9_-]{43}$')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 60
        interval_sec = 60
      }
    }
  }
  rule {
    priority = 200
    action   = "throttle"
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
    rate_limit_options {
      conform_action      = "allow"
      exceed_action       = "deny(429)"
      enforce_on_key      = "HTTP_HEADER"
      enforce_on_key_name = "Authorization"
      rate_limit_threshold {
        count        = 120
        interval_sec = 60
      }
    }
  }
  rule {
    priority = 2147483647
    action   = "allow"
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
  }
}
