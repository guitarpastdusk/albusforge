resource "google_sql_database_instance" "this" {
  project             = var.project_id
  name                = var.name
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection

  settings {
    # db-g1-small and db-custom-* are Enterprise tiers; Enterprise Plus rejects them.
    edition                     = "ENTERPRISE"
    tier                        = var.tier
    availability_type           = var.availability_type
    disk_type                   = "PD_SSD"
    disk_size                   = var.disk_size_gb
    disk_autoresize             = true
    deletion_protection_enabled = var.deletion_protection

    # Private IP only, reached over direct VPC egress (ARCHITECTURE.md §12.2).
    # ENCRYPTED_ONLY: clients use TLS without verifying the server CA.
    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network_id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    # PITR on, 7-day backups (ARCHITECTURE.md §5.2). Times are UTC.
    backup_configuration {
      enabled                        = true
      start_time                     = "08:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day          = 7
      hour         = 9
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled = true
    }
  }
}

resource "google_sql_database" "this" {
  project  = var.project_id
  instance = google_sql_database_instance.this.name
  name     = var.database
}

# Only the owner role is created here. Every user made through the Cloud SQL API
# joins cloudsqlsuperuser, which can create schemas, so the app role is created
# by the migration job instead, with no DDL rights (packages/db).
resource "random_password" "migrate" {
  length  = 32
  special = false
}

resource "google_sql_user" "migrate" {
  project  = var.project_id
  instance = google_sql_database_instance.this.name
  name     = var.migrate_user
  password = random_password.migrate.result

  # The role owns every migrated object; Postgres refuses to drop it while it does.
  deletion_policy = "ABANDON"
}

resource "random_password" "app" {
  length  = 32
  special = false
}

# Passwords live in Terraform state as well as Secret Manager. The state bucket
# is private to the CI project (docs/adr/0006).
resource "google_secret_manager_secret" "password" {
  for_each = toset(["migrate", "app"])

  project   = var.project_id
  secret_id = "db-${each.key}-password"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "migrate" {
  secret      = google_secret_manager_secret.password["migrate"].id
  secret_data = random_password.migrate.result
}

resource "google_secret_manager_secret_version" "app" {
  secret      = google_secret_manager_secret.password["app"].id
  secret_data = random_password.app.result
}
