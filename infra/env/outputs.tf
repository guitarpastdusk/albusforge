output "project_id" {
  value = local.project_id
}

output "url" {
  value = "https://${local.domain}"
}

output "lb_ip" {
  value = module.edge.ip_address
}

output "gateway_service" {
  value = module.gateway.name
}

output "gateway_service_account" {
  value = module.gateway.service_account_email
}
