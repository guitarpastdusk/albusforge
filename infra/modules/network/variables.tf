variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  description = "Base name for the VPC and its attachments."
  type        = string
}

variable "subnet_cidr" {
  type = string
}

variable "psa_address" {
  description = "Start address of the private services access range."
  type        = string
}

variable "psa_prefix_length" {
  type    = number
  default = 16
}
