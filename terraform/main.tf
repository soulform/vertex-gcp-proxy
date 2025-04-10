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
# TEMPORARY: Using broader role for debugging FAILED_PRECONDITION
resource "google_project_iam_member" "run_sa_vertex_ai_user" {
  project = var.project_id
  # role    = "roles/aiplatform.user"
  role    = "roles/aiplatform.admin" # Temporarily broaden role
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

# --- Cloud Run (Definition Only - Image comes later) ---
# Defines the Cloud Run service, configured for VPC access, CMEK, and specific environment variables.
# The container image will be updated in Phase 5 after being built and pushed.
resource "google_cloud_run_v2_service" "default" {
  provider = google-beta # Use beta provider for potential new features like direct VPC egress

  name     = var.cloud_run_service_name
  location = var.region
  ingress = "INGRESS_TRAFFIC_ALL" # Start with wide access for initial testing. SECURE LATER (e.g., INTERNAL_ONLY or INTERNAL_LOAD_BALANCER).

  # Service configuration template
  template {
    service_account = google_service_account.cloud_run_sa.email # Use the dedicated SA for runtime identity.
    encryption_key = google_kms_crypto_key.cmek_key.id # Encrypt runtime state with CMEK.

    # Add or modify labels to force an update
    labels = {
      # Format timestamp to be GCP label compliant (lowercase, numbers, dash)
      "terraform-redeployed-at" = formatdate("YYYYMMDD-hhmmss", timestamp())
    }

    # Configure VPC Access for private communication.
    vpc_access {
      # Use built-in direct VPC egress (Recommended, GA).
      # Connector field is omitted for direct egress.
      egress = "ALL_TRAFFIC" # Allows egress through VPC to reach Google APIs privately.
      network_interfaces {
        network    = google_compute_network.vpc_network.id
        subnetwork = google_compute_subnetwork.vpc_subnet.id
        # tags       = ["cloud-run"] # Optional: Apply tags for firewall targeting if needed.
      }
    }

    # Define the container(s) running in the service.
    containers {
      # Use the image pushed to Artifact Registry in Phase 4.
      image = "${google_artifact_registry_repository.repo.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}/vertex-proxy:latest"

      # Port the container listens on (must match EXPOSE in Dockerfile and app config).
      ports {
        container_port = 8080
      }

      # Environment variables passed to the container.
      # IMPORTANT: Use Secret Manager for EXPECTED_API_KEY in production.
      env {
        name  = "EXPECTED_API_KEY"
        value = var.EXPECTED_API_KEY # Reference the sensitive variable
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id # Pass project ID to the application.
      }
      env {
        name  = "GCP_REGION"
        value = var.region # Pass region to the application.
      }
       env {
         # Pass the Vertex AI API endpoint based on the region.
        name = "VERTEX_AI_ENDPOINT"
        value = "${var.region}-aiplatform.googleapis.com"
      }
       env {
        # Specify the target Vertex AI model ID.
        name = "VERTEX_AI_MODEL_ID"
        # Use specific version from Model Garden
        # value = "gemini-1.5-pro"
        value = "gemini-1.5-pro-002"
      }

      # Define resource requests/limits if needed.
      # resources {
      #   limits = {
      #     cpu    = "1000m"
      #     memory = "512Mi"
      #   }
      # }
    }
  }

  # Ensure necessary IAM permissions and network resources are created before the Cloud Run service.
  depends_on = [
    google_project_iam_member.run_sa_vertex_ai_user,
    google_kms_crypto_key_iam_member.run_sa_cmek_user,
    google_kms_crypto_key_iam_member.run_service_agent_cmek_user,
    google_compute_subnetwork.vpc_subnet # Depends on the subnet being available for VPC Access.
  ]

  # lifecycle {
    # Ensure ignore_changes for the image is commented out or removed
    # so Terraform can manage image updates.
    # ignore_changes = [template[0].containers[0].image]
  # }
}

# (Optional but Recommended) IAM policy to allow only authenticated users to invoke.
# Uncomment and configure as needed, changing the 'member' value.
# resource "google_cloud_run_v2_service_iam_member" "invoker" {
#   project  = google_cloud_run_v2_service.default.project
#   location = google_cloud_run_v2_service.default.location
#   name     = google_cloud_run_v2_service.default.name
#   role     = "roles/run.invoker"
#   member   = "user:your-email@example.com" # Or serviceAccount, group etc.
# } 