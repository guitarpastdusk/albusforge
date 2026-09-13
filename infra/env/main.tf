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

module "edge" {
  source = "../modules/edge"

  project_id      = local.project_id
  region          = var.region
  name            = local.name
  domain          = local.domain
  dns_zone        = local.dns_zone
  default_service = module.gateway.name
}
