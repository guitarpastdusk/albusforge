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

variable "default_service" {
  description = "Cloud Run service name the URL map defaults to."
  type        = string
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
