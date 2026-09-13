# LLM spend guardrail, live before the first real prompt (ARCHITECTURE.md §12.5,
# docs/ASK-TO-ENCLOSURE.md §9). packages/llm writes one structured line per model
# call: jsonPayload.event = "llm_call", jsonPayload.cost_usd = the call's cost.
# Anthropic bills outside GCP, so this metric is the only in-cloud view of spend.

# DISTRIBUTION because a log metric may only use value_extractor with that type;
# the alert sums the distribution back to one number per window.
resource "google_logging_metric" "llm_cost" {
  project = local.project_id
  name    = "llm_cost"
  filter  = "resource.type=\"cloud_run_revision\" AND jsonPayload.event=\"llm_call\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    # Not "USD": Monitoring only accepts UCUM units, and a non-unit makes every
    # query using this metric warn. The dollars are in the name instead.
    unit         = "1"
    display_name = "LLM call cost (USD)"

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

# One window per policy, queried with MQL. Two alternatives don't work here: a
# PromQL condition is rejected until the metric has ingested a point, which it
# can't have before the first model call, and a threshold condition can't reduce
# a DISTRIBUTION to one number. MQL sums the distribution to a scalar.
locals {
  llm_spend_windows = {
    hourly = {
      window = "1h"
      budget = local.settings.llm_hourly_budget_usd
      label  = "the last hour"
    }
    # 22h, not 24h: alerting reads at most 24h of data and a sliding window costs
    # about an hour of headroom on top, so 22h is the longest window accepted.
    # Verified against the Monitoring API.
    daily = {
      window = "22h"
      budget = local.settings.llm_daily_budget_usd
      label  = "the last 22 hours"
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

    condition_monitoring_query_language {
      duration = "0s"
      query    = <<-MQL
        fetch cloud_run_revision::logging.googleapis.com/user/${google_logging_metric.llm_cost.name}
        | align delta(1m)
        | every 1m
        | group_by [], [per_minute: sum(value.${google_logging_metric.llm_cost.name})]
        | group_by sliding(${each.value.window}), [cost_usd: sum(per_minute)]
        | condition cost_usd > ${each.value.budget}
      MQL
    }
  }

  notification_channels = [google_monitoring_notification_channel.spend.id]

  documentation {
    mime_type = "text/markdown"
    content   = "LLM spend crossed its ${each.key} budget. Check `llm_calls` and intake logs; the per-build token ceiling is `LLM_BUILD_TOKEN_CEILING`. Alerts notify but don't stop calls: set a hard spend limit on the API key in the Anthropic console."
  }
}
