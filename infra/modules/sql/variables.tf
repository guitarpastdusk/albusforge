variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  description = "Instance name. Cloud SQL won't reuse a deleted name for about a week."
  type        = string
}

variable "network_id" {
  description = "VPC with private services access already connected."
  type        = string
}

variable "tier" {
  type = string
}

variable "availability_type" {
  type    = string
  default = "ZONAL"
}

variable "disk_size_gb" {
  type    = number
  default = 10
}

variable "database" {
  type    = string
  default = "albusforge"
}

variable "migrate_user" {
  type    = string
  default = "albus_migrate"
}

variable "deletion_protection" {
  type    = bool
  default = true
}
