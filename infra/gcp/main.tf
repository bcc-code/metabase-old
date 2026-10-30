locals {
  services = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "compute.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
  ])
}

resource "google_project_service" "enabled" {
  for_each = local.services

  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "metabase" {
  repository_id = var.name
  location      = var.region
  format        = "DOCKER"
  description   = "BCC Metabase images"

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "7776000s" # 90 days
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "metabase" {
  account_id   = "${var.name}-run"
  display_name = "Metabase on Cloud Run"

  depends_on = [google_project_service.enabled]
}
