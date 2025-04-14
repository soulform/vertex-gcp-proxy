# --- Networking ---
# Provides the VPC network for resource isolation.
resource "google_compute_network" "vpc_network" {
  name                    = var.vpc_network_name
  auto_create_subnetworks = false
}

# Provides the subnet within the VPC, enabling private Google API access.
resource "google_compute_subnetwork" "vpc_subnet" {
  name          = var.vpc_subnet_name
  ip_cidr_range = var.vpc_subnet_cidr
  region        = var.region
  network       = google_compute_network.vpc_network.id
  private_ip_google_access = true # Essential for reaching Google APIs from Cloud Run via VPC
}

# Firewall rule to allow ingress traffic from any IP on port 8080.
# WARNING: This allows traffic from ALL sources. Secure this later by 
# restricting source_ranges, using IAP, or setting Cloud Run ingress to internal.
resource "google_compute_firewall" "allow_ingress_from_all" { # Renamed for clarity
  name    = "${var.vpc_network_name}-allow-public-ingress" # Renamed for clarity
  network = google_compute_network.vpc_network.name
  allow {
    protocol = "tcp"
    ports    = ["8080"] # Port the Node.js app will listen on (matches Dockerfile EXPOSE and server.js PORT)
  }
  source_ranges = ["0.0.0.0/0"] # Allows traffic from any IP address.
  # target_tags = ["cloud-run"] # Optional: Apply to tagged instances if not using Serverless VPC Access directly
}

# --- KMS / CMEK ---
# Creates the KMS Key Ring to hold cryptographic keys.
resource "google_kms_key_ring" "keyring" {
  name     = var.kms_keyring_name
  location = var.region
}

# Creates the KMS CryptoKey used for CMEK encryption.
resource "google_kms_crypto_key" "cmek_key" {
  name            = var.kms_key_name
  key_ring        = google_kms_key_ring.keyring.id
  rotation_period = "100000s" # Example rotation period; adjust as needed.
  purpose         = "ENCRYPT_DECRYPT" # Standard purpose for CMEK

  lifecycle {
    prevent_destroy = true # Protects the key from accidental deletion.
  }
}

# --- Service Accounts & IAM ---
# Creates the dedicated Service Account for the Cloud Run service runtime.
resource "google_service_account" "cloud_run_sa" {
  account_id   = var.cloud_run_sa_name
  display_name = "Service Account for Vertex Proxy Cloud Run Service"
}

# Grants the Cloud Run Service Account permission to call the Vertex AI API.
resource "google_project_iam_member" "run_sa_vertex_ai_user" {
  project = var.project_id
  role    = "roles/aiplatform.user" # Revert back to standard user role
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# Grants the Cloud Run Service Account permission to encrypt/decrypt using the CMEK key at runtime.
resource "google_kms_crypto_key_iam_member" "run_sa_cmek_user" {
  crypto_key_id = google_kms_crypto_key.cmek_key.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# Fetches the GCP project details to get the project number.
data "google_project" "project" {
  project_id = var.project_id
}

# Resource to ensure the service agent identity for Cloud Run exists and retrieve its email
resource "google_project_service_identity" "run_sa_identity" {
  provider = google-beta # Explicitly use the beta provider as required by the documentation
  # Using resource block instead of data as the data source doesn't exist yet
  # This ensures the identity exists (creates if needed) before IAM binding.
  project  = var.project_id
  service  = "run.googleapis.com"
}

# Resource to ensure the service agent identity for Artifact Registry exists and retrieve its email
resource "google_project_service_identity" "ar_sa_identity" {
  provider = google-beta # Explicitly use the beta provider as required by the documentation
  # Using resource block instead of data
  project = var.project_id
  service = "artifactregistry.googleapis.com"
}

# Grants the *Cloud Run Service Agent* permission to use the CMEK key.
# This agent manages the Cloud Run service itself (deployment, state).
resource "google_kms_crypto_key_iam_member" "run_service_agent_cmek_user" {
  crypto_key_id = google_kms_crypto_key.cmek_key.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  # Use the email retrieved from the resource
  member        = "serviceAccount:${resource.google_project_service_identity.run_sa_identity.email}"
}

# Grants the *Artifact Registry Service Agent* permission to use the CMEK key.
# This agent manages the encryption of container images stored in Artifact Registry.
resource "google_kms_crypto_key_iam_member" "ar_service_agent_cmek_user" {
  crypto_key_id = google_kms_crypto_key.cmek_key.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  # Use the email retrieved from the resource
  member        = "serviceAccount:${resource.google_project_service_identity.ar_sa_identity.email}"
}

# --- Artifact Registry ---
# Creates the Artifact Registry repository to store Docker images, encrypted with CMEK.
resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = var.artifact_repo_name
  description   = "Docker repository for Vertex Proxy"
  format        = "DOCKER"
  kms_key_name  = google_kms_crypto_key.cmek_key.id # Links the CMEK key for image encryption.

  # Ensure the Artifact Registry Service Agent has permission on the key before creating the repo.
  depends_on = [
     google_kms_crypto_key_iam_member.ar_service_agent_cmek_user
  ]
}

# --- Cloud Run (Updated for gRPC) ---
resource "google_cloud_run_v2_service" "default" {
  provider = google-beta

  name     = var.cloud_run_service_name
  location = var.region
  # Keep ingress=all, rely on application-level API key check via metadata
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloud_run_sa.email
    # Explicitly set Gen2 execution environment for HTTP/2 & gRPC support
    execution_environment = "EXECUTION_ENVIRONMENT_GEN2" 
    encryption_key = google_kms_crypto_key.cmek_key.id # Keep CMEK

    labels = {
      "terraform-redeployed-at" = formatdate("YYYYMMDD-hhmmss", timestamp())
    }

    vpc_access {
      egress = "ALL_TRAFFIC"
      network_interfaces {
        network    = google_compute_network.vpc_network.id
        subnetwork = google_compute_subnetwork.vpc_subnet.id
      }
    }

    containers {
      image = "${google_artifact_registry_repository.repo.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}/vertex-proxy:latest"

      ports {
        # Cloud Run Gen2 automatically handles HTTP/2 on the container_port
        # The gRPC server listens on this port.
        container_port = 8080 
        name = "h2c" # Standard port name for HTTP/2 cleartext (Cloud Run frontend handles TLS)
      }

      env {
        name  = "EXPECTED_API_KEY"
        value = var.EXPECTED_API_KEY
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }
       # VERTEX_AI_ENDPOINT not needed as SDK infers from region
       env {
        name = "VERTEX_AI_MODEL_ID"
        value = "gemini-1.5-pro-002" 
      }
    }
  }

  depends_on = [
    google_project_iam_member.run_sa_vertex_ai_user,
    google_kms_crypto_key_iam_member.run_sa_cmek_user,
    google_kms_crypto_key_iam_member.run_service_agent_cmek_user,
    google_compute_subnetwork.vpc_subnet
  ]
}

# --- Allow Unauthenticated Access to Cloud Run (Needed for ingress=all without IAM) ---
# This allows network access, but the gRPC server still checks the API Key metadata.
# Requires Org Policy `constraints/iam.allowedPolicyMemberDomains` relaxation for the project.
resource "google_cloud_run_v2_service_iam_member" "allow_unauthenticated" {
  provider = google-beta
  project  = google_cloud_run_v2_service.default.project
  location = google_cloud_run_v2_service.default.location
  name     = google_cloud_run_v2_service.default.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Remove public invoker policy if it exists
# resource "google_cloud_run_v2_service_iam_member" "allow_public_invoker" { ... }


# --- REMOVE API Gateway RESOURCES --- 

# resource "google_api_gateway_api" "api" { ... }
# resource "google_api_gateway_api_config" "api_config" { ... }
# resource "google_api_gateway_gateway" "gateway" { ... }

# --- REMOVE IAM for API Gateway to invoke Cloud Run --- 

# resource "google_project_service_identity" "apigw_sa_identity" { ... }
# resource "google_cloud_run_v2_service_iam_member" "apigw_cloudrun_invoker" { ... } 