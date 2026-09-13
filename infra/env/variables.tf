variable "tfstate_bucket" {
  description = "Bucket holding bootstrap state (bootstrap output tfstate_bucket)."
  type        = string
}

variable "region" {
  type    = string
  default = "us-central1"
}
