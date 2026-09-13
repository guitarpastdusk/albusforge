provider "google" {
  project = local.project_id
  region  = var.region

  default_labels = {
    app = "albusforge"
    env = local.env
  }
}
