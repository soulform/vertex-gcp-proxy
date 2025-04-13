output "cloud_run_service_url" {
  description = "URL of the deployed Cloud Run service"
  value       = google_cloud_run_v2_service.default.uri
}

output "artifact_registry_repository_url" {
  description = "URL of the Artifact Registry repository (used for Docker push)"
  # Format: <region>-docker.pkg.dev/<project-id>/<repo-id>
  value       = "${google_artifact_registry_repository.repo.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
}

output "cloud_run_service_account_email" {
  description = "Email of the Cloud Run runtime service account"
  value       = google_service_account.cloud_run_sa.email
}

output "cmek_key_name" {
  description = "Full resource name of the KMS key used for CMEK"
  value       = google_kms_crypto_key.cmek_key.id
}

output "api_gateway_url" {
  description = "URL of the deployed API Gateway endpoint"
  value       = google_api_gateway_gateway.gateway.default_hostname
} 