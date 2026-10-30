# The application database: Metabase's own data (users, questions, dashboards, permissions, settings, cached query
# results). Not the data Metabase analyses, which stays in BCC's own databases.

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "metabase" {
  name                = "${var.name}-appdb"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.db_deletion_protection

  settings {
    edition                     = "ENTERPRISE"
    tier                        = var.db_tier
    availability_type           = var.db_high_availability ? "REGIONAL" : "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = var.db_disk_size_gb
    disk_autoresize             = true
    deletion_protection_enabled = var.db_deletion_protection

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.metabase.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "01:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 14
      }
    }

    # Sundays, 03:00-04:00 UTC
    maintenance_window {
      day          = 7
      hour         = 3
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled = true
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "metabase" {
  name     = "metabase"
  instance = google_sql_database_instance.metabase.name
}

resource "google_sql_user" "metabase" {
  name     = "metabase"
  instance = google_sql_database_instance.metabase.name
  password = random_password.db.result
}
