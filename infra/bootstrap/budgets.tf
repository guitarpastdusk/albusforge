# ARCHITECTURE.md §12.5: $150 / $300 / $500 on prod. Emails go to the billing
# account's admins and users by default. LLM spend is billed by Anthropic, not
# here — see the daily-spend alert added in M2.
resource "google_billing_budget" "prod" {
  provider = google.billing

  billing_account = var.billing_account
  display_name    = "${local.projects.prod} monthly"

  budget_filter {
    projects = ["projects/${google_project.this["prod"].number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.prod_budget_usd)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.3, 0.6, 1.0]
    content {
      threshold_percent = threshold_rules.value
    }
  }

  depends_on = [google_project_service.this]
}
