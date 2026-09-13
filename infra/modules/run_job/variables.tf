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
  default     = "us-docker.pkg.dev/cloudrun/container/job:latest"
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

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "timeout" {
  type    = string
  default = "600s"
}

variable "max_retries" {
  description = "Deploys wait on the execution, so a failure should surface, not retry quietly."
  type        = number
  default     = 0
}

variable "env" {
  type    = map(string)
  default = {}
}

variable "secret_env" {
  description = "Env var name => Secret Manager secret (full id) and version. The job's SA gets accessor on each."
  type = map(object({
    secret  = string
    version = optional(string, "latest")
  }))
  default = {}
}

variable "runtime_roles" {
  type = list(string)
  default = [
    "roles/logging.logWriter",
  ]
}

variable "deletion_protection" {
  type    = bool
  default = true
}
