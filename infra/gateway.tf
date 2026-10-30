# Public access goes through the BCC platform gateway, which serves every public service on GCP and owns the DNS
# record, the TLS certificate and the HTTP -> HTTPS redirect. This project only publishes a backend for it; the
# gateway routes the host name to it once routes/metabase.yaml is merged in bcc-code/bcc-platform-gateway
# (see README.md).

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
}

# Creates bs-<name>-app-<environment>, the backend service the gateway's route registry refers to by name.
module "gateway_backend" {
  # Pinned to a commit; move it forward when the platform team updates the module.
  source = "github.com/bcc-code/bcc-platform-gateway-tf-modules//gateway-backend?ref=302fb96712c5876d64ce4f76c97c669929986060"

  app         = var.name
  component   = "app"
  environment = local.env

  cloud_run_service = google_cloud_run_v2_service.metabase.name
  region            = google_cloud_run_v2_service.metabase.location
  security_policy   = google_compute_security_policy.metabase.self_link
}
