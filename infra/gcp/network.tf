# A VPC of Metabase's own. Cloud Run sends all its outbound traffic into it (Direct VPC egress): to the application
# database over its private IP, and to everything else (data warehouses, login.bcc.no, email) through Cloud NAT
# with one static IP address, which BCC's databases and firewalls can allow.

resource "google_compute_network" "metabase" {
  name                    = "${var.name}-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.enabled]
}

resource "google_compute_subnetwork" "run" {
  name                     = "${var.name}-run"
  region                   = var.region
  network                  = google_compute_network.metabase.id
  ip_cidr_range            = var.subnet_cidr
  private_ip_google_access = true
}

# Private services access, which gives Cloud SQL a private IP address in the VPC.
resource "google_compute_global_address" "private_services" {
  name          = "${var.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.metabase.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.metabase.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

resource "google_compute_address" "egress" {
  name        = "${var.name}-egress"
  region      = var.region
  description = "Metabase's outbound IP address: allow it on the databases Metabase connects to."

  depends_on = [google_project_service.enabled]
}

resource "google_compute_router" "metabase" {
  name    = "${var.name}-router"
  region  = var.region
  network = google_compute_network.metabase.id
}

resource "google_compute_router_nat" "metabase" {
  name                               = "${var.name}-nat"
  region                             = var.region
  router                             = google_compute_router.metabase.name
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.egress.self_link]
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.run.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
