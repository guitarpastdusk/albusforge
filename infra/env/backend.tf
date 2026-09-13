# State lands at gs://<bucket>/env/<workspace>.tfstate.
# Bucket comes from backend.hcl: terraform init -backend-config=backend.hcl
terraform {
  backend "gcs" {
    prefix = "env"
  }
}
