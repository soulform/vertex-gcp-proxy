output "cloud_run_service_name" {
  description = "The name of the deployed Cloud Run service."
  value       = google_cloud_run_v2_service.default.name
}

output "cloud_run_service_url" {
  description = "The URL of the deployed Cloud Run service (requires :443 for gRPC client)."
  value       = google_cloud_run_v2_service.default.uri
}

output "artifact_registry_repository_url" {
  description = "The full URL of the Artifact Registry repository."
  # Construct the URL format expected by Docker
  value       = "${google_artifact_registry_repository.repo.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
}

output "cloud_run_service_account_email" {
  description = "Email address of the Cloud Run service account."
  value       = google_service_account.cloud_run_sa.email
}

output "kms_key_name" {
  description = "The full resource name of the KMS key used for CMEK."
  value       = google_kms_crypto_key.cmek_key.id
}

# Remove API Gateway URL output
# output "api_gateway_url" {
#   description = "The default hostname of the deployed API Gateway."
#   value       = google_api_gateway_gateway.gateway.default_hostname
# } 