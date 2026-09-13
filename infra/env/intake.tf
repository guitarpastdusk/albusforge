# M2: the intake stage (ask -> spec). Internal only: gateway calls it with an ID
# token over direct VPC egress; nothing public reaches it. docs/ASK-TO-ENCLOSURE.md §3.

module "intake" {
  source = "../modules/run_service"

  project_id          = local.project_id
  region              = var.region
  name                = "intake"
  max_instances       = local.settings.api_max_instances
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  public_invoker      = false
  min_instances       = 0
  deletion_protection = local.settings.deletion_protection

  env = merge(local.db_env, {
    DB_USER                 = local.db_app_role
    GOOGLE_CLOUD_PROJECT    = local.project_id
    LLM_PROVIDER            = "anthropic"
    LLM_MODEL               = "claude-opus-5"
    LLM_EFFORT              = "medium"
    LLM_BUILD_TOKEN_CEILING = tostring(local.settings.llm_build_token_ceiling)
    REGISTRY_INCLUDE_DRAFTS = tostring(local.settings.registry_include_drafts)
  })
  secret_env = {
    DB_PASSWORD = { secret = module.sql.app_password_secret }
    # The version is added by hand (secrets.tf); a revision can't start without one.
    ANTHROPIC_API_KEY = { secret = google_secret_manager_secret.external["anthropic-api-key"].id }
  }
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invokes_intake" {
  project  = local.project_id
  location = var.region
  name     = module.intake.name
  role     = "roles/run.invoker"
  member   = module.gateway.service_account_member
}
