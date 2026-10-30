terraform {
  # The state lives in the Infra Platform's storage: the Deploy Terraform workflow fills in the backend settings.
  backend "azurerm" {}

  required_version = ">= 1.5.0"

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
}

provider "google" {
  region          = local.region
  project         = local.project_id
  billing_project = local.project_id

  default_labels = {
    app         = var.name
    environment = local.env
    managed-by  = "terraform"
  }
}
