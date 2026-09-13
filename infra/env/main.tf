module "network" {
  source = "../modules/network"

  project_id  = local.project_id
  region      = var.region
  name        = local.name
  subnet_cidr = local.settings.subnet_cidr
  psa_address = local.settings.psa_address
}

# M0 placeholder: the real gateway image arrives from CI. Ingress, egress and
# scaling are already the production shape.
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
}
