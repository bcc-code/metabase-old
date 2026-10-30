resource "google_monitoring_uptime_check_config" "metabase" {
  display_name = "Metabase health (${local.hostname})"
  timeout      = "10s"
  period       = "60s"
  checker_type = "STATIC_IP_CHECKERS"

  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = local.project_id
      host       = local.hostname
    }
  }

  content_matchers {
    content = "ok"
    matcher = "CONTAINS_STRING"
  }
}

resource "google_monitoring_notification_channel" "email" {
  count = var.alert_email == "" ? 0 : 1

  display_name = "Metabase alerts"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_alert_policy" "down" {
  count = var.alert_email == "" ? 0 : 1

  display_name          = "Metabase is down (${local.hostname})"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email[0].id]

  conditions {
    display_name = "Health check failing"

    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.metabase.uptime_check_id}\" AND resource.type=\"uptime_url\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    content   = "Metabase at https://${local.hostname} fails its health check. See Cloud Run logs for the ${var.name} service."
    mime_type = "text/markdown"
  }
}
