variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region for resources"
  type        = string
  default     = "europe-west1" # Adjust as needed
}

variable "vpc_network_name" {
  description = "Name for the VPC network"
  type        = string
  default     = "vertex-proxy-vpc"
}

variable "vpc_subnet_name" {
  description = "Name for the VPC subnet"
  type        = string
  default     = "vertex-proxy-subnet"
}

variable "vpc_subnet_cidr" {
  description = "CIDR range for the VPC subnet"
  type        = string
  default     = "10.10.0.0/24" # Adjust as needed
}

variable "kms_keyring_name" {
  description = "Name for the KMS KeyRing"
  type        = string
  default     = "vertex-proxy-keyring"
}

variable "kms_key_name" {
  description = "Name for the KMS CryptoKey (CMEK)"
  type        = string
  default     = "vertex-proxy-cmek"
}

variable "artifact_repo_name" {
  description = "Name for the Artifact Registry repository"
  type        = string
  default     = "vertex-proxy-repo"
}

variable "cloud_run_service_name" {
  description = "Name for the Cloud Run service"
  type        = string
  default     = "vertex-proxy-service"
}

variable "cloud_run_sa_name" {
  description = "Name for the Cloud Run runtime Service Account"
  type        = string
  default     = "vertex-proxy-run-sa"
}

variable "EXPECTED_API_KEY" {
  description = "The secret API key clients must provide in the X-API-Key header."
  type        = string
  sensitive   = true # Marks the variable as sensitive in Terraform logs/outputs
}

# Removed: Variable for specific IP address firewall rule.
# variable "my_ip_address" {
#   description = "Your public IP address for firewall rule (e.g., 'x.x.x.x/32')"
#   type        = string
#   # default = "YOUR_IP_HERE/32" # Or fetch dynamically
# } 