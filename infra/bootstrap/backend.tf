# First apply runs with local state: the bucket below is created by this root.
# After it exists, uncomment and run:
#   terraform init -migrate-state -backend-config="bucket=$(terraform output -raw tfstate_bucket)"

# terraform {
#   backend "gcs" {
#     prefix = "bootstrap"
#   }
# }
