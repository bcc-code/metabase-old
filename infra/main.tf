locals {
  props = merge(jsondecode(var.props), jsondecode(var.deployment_props))

  env        = local.props.app_environment
  project_id = local.props.gcp.project_id
  region     = local.props.gcp.location

  # prod and staging hold production data and serve people; dev and sandbox are for trying things out.
  production_context = contains(["prod", "staging"], local.env)

  hostname = coalesce(var.hostname, local.env == "prod" ? "${var.name}.bcc.no" : "${var.name}.${local.env}.bcc.no")

  cpu           = coalesce(var.cpu, local.production_context ? "2" : "1")
  memory        = coalesce(var.memory, local.production_context ? "4Gi" : "2Gi")
  max_instances = coalesce(var.max_instances, local.production_context ? 3 : 1)
  db_tier       = coalesce(var.db_tier, local.production_context ? "db-custom-2-7680" : "db-custom-1-3840")
}

data "google_project" "main" {}

# The platform enables the other APIs this configuration uses when it provisions the project.
resource "google_project_service" "servicenetworking" {
  service            = "servicenetworking.googleapis.com"
  disable_on_destroy = false
}

# Images of the BCC Metabase fork, pushed by the Build and deploy Metabase workflow.
resource "google_artifact_registry_repository" "metabase" {
  repository_id = var.name
  location      = local.region
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
}

resource "google_service_account" "metabase" {
  account_id   = "${var.name}-run"
  display_name = "Metabase on Cloud Run"
}
