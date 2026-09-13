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

resource "google_monitoring_alert_policy" "llm_spend" {
  project      = local.project_id
  display_name = "LLM spend over budget (${local.env})"
  combiner     = "OR"

  conditions {
    display_name = "LLM cost in the last hour > $${local.settings.llm_hourly_budget_usd}"
    condition_prometheus_query_language {
      query               = "sum(increase(logging_googleapis_com:user_llm_cost_sum[1h])) > ${local.settings.llm_hourly_budget_usd}"
      duration            = "0s"
      evaluation_interval = "60s"
    }
  }

  conditions {
    display_name = "LLM cost in the last 24 hours > $${local.settings.llm_daily_budget_usd}"
    condition_prometheus_query_language {
      query               = "sum(increase(logging_googleapis_com:user_llm_cost_sum[24h])) > ${local.settings.llm_daily_budget_usd}"
      duration            = "0s"
      evaluation_interval = "300s"
    }
  }

  notification_channels = [google_monitoring_notification_channel.spend.id]

  documentation {
    mime_type = "text/markdown"
    content   = "LLM spend crossed its budget. Check `llm_calls` and intake logs; the per-build token ceiling is `LLM_BUILD_TOKEN_CEILING`. Set a hard spend limit on the API key in the Anthropic console."
  }

  depends_on = [google_logging_metric.llm_cost]
}
