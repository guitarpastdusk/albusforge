# First apply runs with local state: the bucket below is created by this root.
# After it exists, capture the bucket name BEFORE uncommenting — with the block
# active, `terraform output` fails until init has run:
#   TFSTATE_BUCKET=$(terraform output -raw tfstate_bucket)
# then uncomment and run:
#   terraform init -migrate-state -backend-config="bucket=$TFSTATE_BUCKET"

# terraform {
#   backend "gcs" {
#     prefix = "bootstrap"
#   }
# }
