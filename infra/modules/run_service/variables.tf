variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  type = string
}

variable "image" {
  description = "Initial image only. Ignored after creation; CI deploys by digest."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "network" {
  type = string
}

variable "subnetwork" {
  type = string
}

variable "egress" {
  type    = string
  default = "ALL_TRAFFIC"
}

variable "ingress" {
  description = "INGRESS_TRAFFIC_INTERNAL_ONLY for internal services; INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER for anything behind the LB."
  type        = string
  default     = "INGRESS_TRAFFIC_INTERNAL_ONLY"
}

variable "public_invoker" {
  type    = bool
  default = false
}

variable "min_instances" {
  type    = number
  default = 0
}

variable "max_instances" {
  type    = number
  default = 10
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "cpu_idle" {
  description = "false = CPU always allocated."
  type        = bool
  default     = true
}

variable "env" {
  description = "Plain environment variables. Secrets go in secret_env."
  type        = map(string)
  default     = {}
}

variable "secret_env" {
  description = "Env var name => Secret Manager secret (full id) and version. The runtime SA gets accessor on each."
  type = map(object({
    secret  = string
    version = optional(string, "latest")
  }))
  default = {}
}

variable "runtime_roles" {
  type = list(string)
  default = [
    "roles/cloudtrace.agent",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ]
}

variable "deletion_protection" {
  type    = bool
  default = true
}
