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

output "web_service" {
  value = module.web.name
}

output "web_service_account" {
  value = module.web.service_account_email
}

output "sql_instance" {
  value = module.sql.instance_name
}

output "jobs" {
  value = [module.db_migrate.name, module.registry_load.name]
}

output "intake_service" {
  value = module.intake.name
}

output "sensor_services" {
  value = { cloudlink = module.cloudlink.name, ask = module.ask.name }
}

output "telemetry_jobs" {
  value = [for job in module.telemetry_jobs : job.name]
}
