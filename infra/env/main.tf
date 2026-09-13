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
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  public_invoker      = true
  min_instances       = local.settings.gateway_min_instances
  deletion_protection = local.settings.deletion_protection

  env = merge(local.db_env, {
    PUBLIC_DOMAIN        = local.domain
    SSR_SERVICE_ACCOUNT  = module.web.service_account_email
    GOOGLE_CLOUD_PROJECT = local.project_id
    DB_USER              = local.db_app_role
  })
  secret_env = {
    DB_PASSWORD = { secret = module.sql.app_password_secret }
  }
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
    gateway = module.gateway.name
    web     = module.web.name
  }
  default_backend = "web"
  path_rules = [
    { paths = ["/v1", "/v1/*"], backend = "gateway" },
  ]
  strip_request_headers = local.internal_request_headers
}
