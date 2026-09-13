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

variable "telemetry_schedules_enabled" {
  description = "Enable only after migration and successful manual executions of the reviewed job digest."
  type        = bool
  default     = false
}

variable "ask_model_enabled" {
  description = "Enable paid narration only after selecting a model and approving its provider budget."
  type        = bool
  default     = false
}

variable "ask_model" {
  description = "Provider model ID; required when Ask narration is enabled."
  type        = string
  default     = ""
  validation {
    condition     = !var.ask_model_enabled || length(trimspace(var.ask_model)) > 0
    error_message = "Select an explicit model before enabling Ask narration."
  }
}
