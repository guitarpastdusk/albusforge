# No default project: every resource here names the project it lands in.
provider "google" {
  region = var.region
}

# The Budgets API bills its calls to a quota project, which user ADC doesn't
# carry. local.projects.ci is known at plan time, so this works on the first apply.
provider "google" {
  alias                 = "billing"
  region                = var.region
  user_project_override = true
  billing_project       = local.projects.ci
}
