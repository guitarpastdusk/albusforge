variable "tfstate_bucket" {
  description = "Bucket holding bootstrap state (bootstrap output tfstate_bucket)."
  type        = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "alert_email" {
  description = "Where LLM spend alerts go."
  type        = string
}
