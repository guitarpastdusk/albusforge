module "network" {
  source = "../modules/network"

  project_id  = local.project_id
  region      = var.region
  name        = local.name
  subnet_cidr = local.settings.subnet_cidr
  psa_address = local.settings.psa_address
}

# Placeholder until the gateway deploy workflow ships its image. Ingress, egress
# and scaling are already the production shape. It connects to Postgres as the
# app role, which can read and write but not change the schema.
module "gateway" {
  source = "../modules/run_service"

  project_id          = local.project_id
  region              = var.region
  name                = "gateway"
  max_instances       = local.settings.api_max_instances
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  public_invoker      = true
  min_instances       = local.settings.gateway_min_instances
  deletion_protection = local.settings.deletion_protection

  # Gateway calls intake after answering the client (the chat reply arrives over
  # SSE), so CPU must stay allocated between requests.
  cpu_idle = false

  env = merge(local.db_env, {
    PUBLIC_DOMAIN                   = local.domain
    SSR_SERVICE_ACCOUNT             = module.web.service_account_email
    GOOGLE_CLOUD_PROJECT            = local.project_id
    DB_USER                         = local.db_app_role
    INTAKE_URL                      = module.intake.uri
    ASK_URL                         = module.ask.uri
    REGISTRY_INCLUDE_DRAFTS         = tostring(local.settings.registry_include_drafts)
    OBSERVATION_READS_ENABLED       = var.observation_reads_enabled ? "1" : "0"
    CAMERA_IMAGES_BUCKET            = google_storage_bucket.observations.name
    OBSERVATION_STORAGE_WORKER_PATH = "/app/storage-worker.cjs"
  }, local.firmware_gateway_env, local.device_provisioning_env)
  secret_env = merge({
    DB_PASSWORD    = { secret = module.sql.app_password_secret }
    RESEND_API_KEY = { secret = google_secret_manager_secret.external["resend-api-key"].id }
  }, local.device_provisioning_secrets)
}

# The portal. Serves the apex and every tenant subdomain (docs/adr/0007).
module "web" {
  source = "../modules/run_service"

  project_id          = local.project_id
  region              = var.region
  name                = "web"
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  public_invoker      = true
  min_instances       = local.settings.web_min_instances
  deletion_protection = local.settings.deletion_protection

  env = {
    PUBLIC_DOMAIN        = local.domain
    GATEWAY_INTERNAL_URL = module.gateway.uri
    # Structured logs link each entry to its request trace:
    # logging.googleapis.com/trace = projects/<this>/traces/<id>.
    GOOGLE_CLOUD_PROJECT = local.project_id
  }
}

module "edge" {
  source = "../modules/edge"

  project_id = local.project_id
  region     = var.region
  name       = local.name
  domain     = local.domain
  dns_zone   = local.dns_zone

  services = {
    gateway   = module.gateway.name
    web       = module.web.name
    cloudlink = module.cloudlink.name
  }
  disable_request_logging   = ["cloudlink"]
  backend_security_policies = { cloudlink = google_compute_security_policy.cloudlink.id }
  default_backend           = "web"
  path_rules = [
    { paths = ["/v1", "/v1/*"], backend = "gateway" },
    { paths = ["/ingest", "/ingest/*"], backend = "cloudlink" },
  ]
  strip_request_headers = local.internal_request_headers
}
