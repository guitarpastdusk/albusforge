# State lives in the bucket this root created: gs://albusforge-ci-tfstate/bootstrap.
#   terraform init -backend-config="bucket=albusforge-ci-tfstate"
#
# Rebuilding from nothing (no bucket yet): comment this block out for the first
# apply, then restore it and migrate. See infra/README.md.
terraform {
  backend "gcs" {
    prefix = "bootstrap"
  }
}
