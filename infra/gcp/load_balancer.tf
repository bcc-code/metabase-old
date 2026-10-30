# Global external Application Load Balancer in front of Cloud Run: a static IP address for the DNS record, a
# Google-managed TLS certificate for var.domain, HTTP -> HTTPS redirects and Cloud Armor.

resource "google_compute_global_address" "lb" {
  name = "${var.name}-lb"

  depends_on = [google_project_service.enabled]
}

resource "google_compute_region_network_endpoint_group" "metabase" {
  name                  = "${var.name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.metabase.name
  }
}

# Rate limiting only. Cloud Armor's preconfigured WAF rules (SQL injection, XSS) are left out on purpose: Metabase's
# own requests carry SQL (native questions) and HTML (text cards), which those rules would block.
resource "google_compute_security_policy" "metabase" {
  name        = "${var.name}-policy"
  description = "Rate limiting per client IP for Metabase"
  type        = "CLOUD_ARMOR"

  rule {
    action      = "throttle"
    priority    = 1000
    description = "Limit requests per client IP"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = var.rate_limit_per_minute
        interval_sec = 60
      }
    }
  }

  rule {
    action      = "allow"
    priority    = 2147483647
    description = "Default rule"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_compute_backend_service" "metabase" {
  name                  = "${var.name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = google_compute_security_policy.metabase.id

  backend {
    group = google_compute_region_network_endpoint_group.metabase.id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_managed_ssl_certificate" "metabase" {
  name = "${var.name}-cert"

  managed {
    domains = [var.domain]
  }

  depends_on = [google_project_service.enabled]
}

resource "google_compute_ssl_policy" "metabase" {
  name            = "${var.name}-tls"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"

  depends_on = [google_project_service.enabled]
}

resource "google_compute_url_map" "https" {
  name            = "${var.name}-https"
  default_service = google_compute_backend_service.metabase.id
}

resource "google_compute_target_https_proxy" "metabase" {
  name             = "${var.name}-https"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.metabase.id]
  ssl_policy       = google_compute_ssl_policy.metabase.id
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${var.name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb.id
  port_range            = "443"
  target                = google_compute_target_https_proxy.metabase.id
}

resource "google_compute_url_map" "http_redirect" {
  name = "${var.name}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }

  depends_on = [google_project_service.enabled]
}

resource "google_compute_target_http_proxy" "http_redirect" {
  name    = "${var.name}-http-redirect"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "${var.name}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb.id
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_redirect.id
}
