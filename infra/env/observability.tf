# LLM spend guardrail, live before the first real prompt (ARCHITECTURE.md §12.5,
# docs/ASK-TO-ENCLOSURE.md §9). packages/llm writes one structured line per model
# call: jsonPayload.event = "llm_call", jsonPayload.cost_usd = the call's cost.
# Anthropic bills outside GCP, so this metric is the only in-cloud view of spend.

resource "google_logging_metric" "llm_cost" {
  project = local.project_id
  name    = "llm_cost"
  filter  = "resource.type=\"cloud_run_revision\" AND jsonPayload.event=\"llm_call\""

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "USD"
    display_name = "LLM call cost"

    labels {
      key         = "stage"
      value_type  = "STRING"
      description = "Pipeline stage that made the call"
    }
  }

  value_extractor = "EXTRACT(jsonPayload.cost_usd)"
  label_extractors = {
    stage = "EXTRACT(jsonPayload.stage)"
  }

  bucket_options {
    exponential_buckets {
      num_finite_buckets = 24
      growth_factor      = 2
      scale              = 0.0001
    }
  }
}

resource "google_monitoring_notification_channel" "spend" {
  project      = local.project_id
  display_name = "LLM spend (${local.env})"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }
}

# Cloud Monitoring allows one PromQL condition per policy, so the hourly and
# 24-hour budgets are separate policies. The selector is explicit because a user
# log metric can be associated with several monitored resource types.
locals {
  llm_cost_sum = "logging_googleapis_com:user_llm_cost_sum{monitored_resource=\"cloud_run_revision\"}"

  llm_spend_windows = {
    hourly = {
      window     = "1h"
      budget     = local.settings.llm_hourly_budget_usd
      evaluation = "60s"
      label      = "the last hour"
    }
    daily = {
      window     = "24h"
      budget     = local.settings.llm_daily_budget_usd
      evaluation = "300s"
      label      = "the last 24 hours"
    }
  }
}

resource "google_monitoring_alert_policy" "llm_spend" {
  for_each = local.llm_spend_windows

  project      = local.project_id
  display_name = "LLM spend over ${each.key} budget (${local.env})"
  combiner     = "OR"

  conditions {
    display_name = "LLM cost in ${each.value.label} > $${each.value.budget}"
    condition_prometheus_query_language {
      query               = "sum(increase(${local.llm_cost_sum}[${each.value.window}])) > ${each.value.budget}"
      duration            = "0s"
      evaluation_interval = each.value.evaluation
    }
  }

  notification_channels = [google_monitoring_notification_channel.spend.id]

  documentation {
    mime_type = "text/markdown"
    content   = "LLM spend crossed its ${each.key} budget. Check `llm_calls` and intake logs; the per-build token ceiling is `LLM_BUILD_TOKEN_CEILING`. Alerts notify but don't stop calls: set a hard spend limit on the API key in the Anthropic console."
  }

  depends_on = [google_logging_metric.llm_cost]
}
