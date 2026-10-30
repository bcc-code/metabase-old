# Secrets reach Metabase from Secret Manager, never as plain environment values. Both are generated here, so they
# also sit in the Terraform state: keep the state bucket private.

resource "random_password" "encryption_key" {
  length  = 64
  special = false
}

locals {
  secrets = {
    db-password    = random_password.db.result
    encryption-key = random_password.encryption_key.result
  }
}

resource "google_secret_manager_secret" "metabase" {
  for_each = local.secrets

  secret_id = "${var.name}-${each.key}"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "metabase" {
  for_each = local.secrets

  secret      = google_secret_manager_secret.metabase[each.key].id
  secret_data = each.value
}

resource "google_secret_manager_secret_iam_member" "metabase" {
  for_each = local.secrets

  secret_id = google_secret_manager_secret.metabase[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.metabase.member
}
