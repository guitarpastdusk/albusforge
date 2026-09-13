variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  type = string
}

variable "domain" {
  description = "Hostname this LB serves, without trailing dot."
  type        = string
}

variable "dns_zone" {
  description = "Cloud DNS managed zone (in project_id) authoritative for domain."
  type        = string
}

variable "include_wildcard" {
  description = "Also serve *.domain — per-tenant hosting."
  type        = bool
  default     = true
}

variable "services" {
  description = "Backend key => Cloud Run service name. Each gets a serverless NEG and backend service."
  type        = map(string)
}

variable "default_backend" {
  description = "Key in services that receives every request no path rule matches."
  type        = string

  validation {
    condition     = contains(keys(var.services), var.default_backend)
    error_message = "default_backend must be a key in services."
  }
}

variable "path_rules" {
  description = "Applied to every hostname. \"/v1/*\" does not match \"/v1\" itself; list both."
  type = list(object({
    paths   = list(string)
    backend = string
  }))
  default = []

  validation {
    condition     = alltrue([for r in var.path_rules : contains(keys(var.services), r.backend)])
    error_message = "Every path_rules backend must be a key in services."
  }
}

variable "strip_request_headers" {
  description = "Removed from every public request before it reaches a backend. For headers a backend trusts only from internal callers."
  type        = list(string)
  default     = []
}

variable "rate_limit_count" {
  description = "Requests per IP per interval before Cloud Armor returns 429."
  type        = number
  default     = 600
}

variable "rate_limit_interval_sec" {
  type    = number
  default = 60
}

variable "backend_security_policies" {
  description = "Optional per-backend policy overrides; defaults to the shared edge policy."
  type        = map(string)
  default     = {}
}

variable "disable_request_logging" {
  description = "Backend keys whose request logs must be disabled (e.g. sensitive Armor rate keys)."
  type        = set(string)
  default     = []
}
