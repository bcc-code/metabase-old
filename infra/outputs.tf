output "url" {
  description = "Metabase's address, once the platform gateway routes it."
  value       = "https://${local.hostname}"
}

output "egress_ip" {
  description = "The address Metabase connects from. Allow it on the databases Metabase analyses, and wherever else it needs access."
  value       = google_compute_address.egress.address
}

output "gateway_backend_service" {
  description = "The backend service the gateway's routes/metabase.yaml refers to."
  value       = module.gateway_backend.backend_service_name
}

output "gateway_route_snippet" {
  description = "Fragment for routes/metabase.yaml in bcc-code/bcc-platform-gateway."
  value       = module.gateway_backend.route_registry_snippet
}

output "image_repository" {
  description = "Artifact Registry repository the Build and deploy Metabase workflow pushes images to."
  value       = "${local.region}-docker.pkg.dev/${local.project_id}/${google_artifact_registry_repository.metabase.repository_id}"
}

output "cloud_run_service" {
  description = "Name of the Cloud Run service."
  value       = google_cloud_run_v2_service.metabase.name
}

output "database_instance" {
  description = "Connection name of the Cloud SQL instance holding the application database."
  value       = google_sql_database_instance.metabase.connection_name
}
