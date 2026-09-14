variable "tfstate_bucket" {
  description = "Bucket holding bootstrap state (bootstrap output tfstate_bucket)."
  type        = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "observation_uploads_enabled" {
  description = "Activate only after schema, private bucket, maintenance and staged acceptance."
  type        = bool
  default     = false
}
variable "observation_reads_enabled" {
  description = "Activate tenant-authorized media reads only after schema and private bucket acceptance."
  type        = bool
  default     = false
}
variable "observation_schedule_enabled" {
  description = "Unpause only after successful manual execution of the certified maintenance image."
  type        = bool
  default     = false
}
variable "observation_storage_budget_bytes" {
  description = "Capacity alert including retained media; operational budget signal, not a billing cap."
  type        = number
  default     = 1073741824
  validation {
    condition     = var.observation_storage_budget_bytes >= 1048576
    error_message = "Observation storage budget must be at least 1 MiB."
  }
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
    condition     = (var.ask_model == "" && !var.ask_model_enabled) || var.ask_model == "claude-haiku-4-5"
    error_message = "Ask supports only claude-haiku-4-5; an empty model is permitted only with narration disabled."
  }
}
