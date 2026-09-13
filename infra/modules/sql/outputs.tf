output "instance_name" {
  value = google_sql_database_instance.this.name
}

output "connection_name" {
  value = google_sql_database_instance.this.connection_name
}

output "private_ip" {
  value = google_sql_database_instance.this.private_ip_address
}

output "database" {
  value = google_sql_database.this.name
}

output "migrate_user" {
  value = google_sql_user.migrate.name
}

# Taken from the versions, so anything that mounts a secret waits for its value.
output "migrate_password_secret" {
  value = google_secret_manager_secret_version.migrate.secret
}

output "app_password_secret" {
  value = google_secret_manager_secret_version.app.secret
}
