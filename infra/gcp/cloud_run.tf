locals {
  env = merge(
    {
      MB_DB_TYPE               = "postgres"
      MB_DB_CONNECTION_URI     = "jdbc:postgresql://${google_sql_database_instance.metabase.private_ip_address}:5432/${google_sql_database.metabase.name}?sslmode=require"
      MB_DB_USER               = google_sql_user.metabase.name
      MB_SITE_URL              = "https://${var.domain}"
      MB_JETTY_PORT            = "3000"
      JAVA_TIMEZONE            = var.timezone
      JAVA_OPTS                = "-XX:MaxRAMPercentage=75"
      MB_COLORIZE_LOGS         = "false"
      MB_EMOJI_IN_LOGS         = "false"
      MB_ANON_TRACKING_ENABLED = "false"
      MB_CHECK_FOR_UPDATES     = "false"
    },
    var.extra_env,
  )

  secret_env = {
    MB_DB_PASS               = "db-password"
    MB_ENCRYPTION_SECRET_KEY = "encryption-key"
  }
}

resource "google_cloud_run_v2_service" "metabase" {
  name     = var.name
  location = var.region

  # Only the load balancer reaches Metabase, so Cloud Armor and the managed certificate always apply. People sign in
  # to Metabase itself (login.bcc.no), and public links and embeds must work without a Google account, so Cloud Run
  # doesn't check who calls it.
  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  invoker_iam_disabled = true

  template {
    service_account                  = google_service_account.metabase.email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    timeout                          = "3600s" # long-running queries and large exports
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.metabase.id
        subnetwork = google_compute_subnetwork.run.id
      }
      egress = "ALL_TRAFFIC"
    }

    containers {
      image = var.image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # Instance-based billing: CPU stays allocated between requests, so alerts, subscriptions, database sync and
        # automatic cache refreshing keep running in the background.
        cpu_idle          = false
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.metabase[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      # The first start runs the application database migrations, which takes a few minutes.
      startup_probe {
        initial_delay_seconds = 30
        period_seconds        = 10
        timeout_seconds       = 5
        failure_threshold     = 48
        http_get {
          path = "/api/health"
          port = 3000
        }
      }

      liveness_probe {
        period_seconds    = 30
        timeout_seconds   = 10
        failure_threshold = 6
        http_get {
          path = "/api/health"
          port = 3000
        }
      }
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_secret_manager_secret_iam_member.metabase,
    google_secret_manager_secret_version.metabase,
    google_sql_user.metabase,
    google_compute_router_nat.metabase,
  ]
}
