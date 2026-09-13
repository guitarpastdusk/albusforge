# M1: Postgres and the jobs that prepare it before gateway deploys.
# ARCHITECTURE.md §5.2, §12.2; roles in packages/db/README.md.

module "sql" {
  source = "../modules/sql"

  project_id          = local.project_id
  region              = var.region
  name                = "${local.name}-pg"
  network_id          = module.network.network_id
  tier                = local.settings.sql_tier
  deletion_protection = local.settings.deletion_protection

  # Private IP needs the private services access peering in place first.
  depends_on = [module.network]
}

locals {
  db_env = {
    DB_HOST = module.sql.private_ip
    DB_NAME = module.sql.database
    DB_SSL  = "require"
  }
}

# Runs packages/db migrations as the owner role, then creates or updates the
# app role and its grants. The gateway deploy workflow executes it, and waits,
# before rolling out a new gateway revision.
module "db_migrate" {
  source = "../modules/run_job"

  project_id          = local.project_id
  region              = var.region
  name                = "db-migrate"
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  deletion_protection = local.settings.deletion_protection

  env = merge(local.db_env, {
    DB_USER     = module.sql.migrate_user
    DB_APP_ROLE = local.db_app_role
  })
  secret_env = {
    DB_PASSWORD     = { secret = module.sql.migrate_password_secret }
    DB_APP_PASSWORD = { secret = module.sql.app_password_secret }
  }
}

# Loads registry/ into registry.parts as the app role, after migrations.
module "registry_load" {
  source = "../modules/run_job"

  project_id          = local.project_id
  region              = var.region
  name                = "registry-load"
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  deletion_protection = local.settings.deletion_protection

  env = merge(local.db_env, {
    DB_USER = local.db_app_role
  })
  secret_env = {
    DB_PASSWORD = { secret = module.sql.app_password_secret }
  }
}
