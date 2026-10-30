output "load_balancer_ip" {
  description = "Point an A record for the domain at this address. The managed certificate is issued once it resolves (up to about an hour)."
  value       = google_compute_global_address.lb.address
}

output "egress_ip" {
  description = "The address Metabase connects from. Allow it on the databases Metabase analyses, and wherever else it needs access."
  value       = google_compute_address.egress.address
}

output "url" {
  description = "Metabase's address."
  value       = "https://${var.domain}"
}

output "image_repository" {
  description = "Artifact Registry repository to push the BCC Metabase image to."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.metabase.repository_id}"
}

output "cloud_run_service" {
  description = "Name of the Cloud Run service."
  value       = google_cloud_run_v2_service.metabase.name
}

output "database_instance" {
  description = "Connection name of the Cloud SQL instance holding the application database."
  value       = google_sql_database_instance.metabase.connection_name
}
