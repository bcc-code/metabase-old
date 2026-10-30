terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.10, < 8.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Keep the state in a GCS bucket with versioning on, readable only by the people who run Terraform: it holds the
  # generated database password and encryption key. Create the bucket once, then uncomment this block.
  # backend "gcs" {
  #   bucket = "bcc-metabase-terraform-state"
  #   prefix = "metabase"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = {
    app        = var.name
    managed-by = "terraform"
  }
}
