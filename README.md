# Secure Cloud-Native Vertex AI Proxy (Cloud Run + Terraform)

## Description

This project provides a **secure, cloud-native proxy service** designed to run as a managed application on **Google Cloud Run**. It bridges the gap between client applications using simple API Key authentication and Google Cloud's powerful Vertex AI Gemini endpoints, which require robust IAM-based authentication.

**Why this project?** While basic proxies might run locally or in Docker and require manual management of Service Account JSON keys, this solution offers significant advantages for users operating within the GCP ecosystem:

1.  **Enhanced Security:** Leverages Cloud Run's **IAM runtime identity**, eliminating the need to download, manage, and secure risky Service Account key files. Authentication to Vertex AI happens securely within GCP's managed infrastructure.
2.  **Cloud-Native & Managed:** Deploys as a scalable, serverless application on **Cloud Run**, removing the burden of managing servers, patching OS, or configuring scaling.
3.  **Infrastructure as Code:** Provides a complete, production-ready infrastructure setup defined in **Terraform**, including VPC networking, firewall rules, KMS keys for CMEK, dedicated IAM service accounts, and Artifact Registry – ensuring reproducible and auditable deployments.
4.  **Built-in Security Layers:** Integrates **VPC network confinement** for network isolation and **Customer-Managed Encryption Keys (CMEK)** for encrypting container images and runtime state, adhering to GCP security best practices.

The service receives requests with a predefined API key, validates it, and securely forwards the request to the configured Vertex AI Gemini endpoint using its integrated GCP identity.

## Key Differentiating Features

* **Secure IAM Authentication:** Translates client API Keys to Vertex AI calls authenticated via the Cloud Run service's **runtime IAM identity** (No downloaded service account keys needed).
* **Managed Cloud-Native Deployment:** Runs as a scalable, serverless application on **Google Cloud Run**.
* **Infrastructure as Code (Terraform):** Complete GCP infrastructure (VPC, Firewall, KMS, IAM, Cloud Run, Artifact Registry) defined and managed via Terraform for reproducible, secure deployments.
* **Enhanced Security Posture:**
    * Eliminates risks associated with managing exported Service Account JSON keys.
    * Includes **VPC network confinement** for network isolation.
    * Applies **Customer-Managed Encryption Keys (CMEK)** via Cloud KMS for Artifact Registry images and Cloud Run runtime state.
* **Node.js Proxy Logic:** Handles request validation, calls the Vertex AI API (using `@google-cloud/aiplatform`), and provides a base for optional response transformation.

## Technology Stack

* **Cloud Provider:** Google Cloud Platform (GCP)
* **Infrastructure as Code:** Terraform (~> 5.0)
* **Compute:** Cloud Run (v2) - *Managed & Serverless*
* **Networking:** VPC Network, Cloud Firewall - *Secure Isolation*
* **Security:** IAM Service Accounts, Key Management Service (KMS) - *CMEK & Secure Identity*
* **Containerization:** Docker, Artifact Registry - *CMEK Encrypted*
* **Application Runtime:** Node.js (v18+)
* **Application Framework:** Express.js
* **GCP SDK:** `@google-cloud/aiplatform` (Node.js)

## Prerequisites

1.  **GCP Project:** A Google Cloud Project with Billing enabled. Note your Project ID and Project Number.
2.  **Enabled APIs:** Ensure the following APIs are enabled in your GCP project:
    * Cloud Run API
    * Vertex AI API
    * Artifact Registry API
    * Cloud Key Management Service (KMS) API
    * Compute Engine API
    * Cloud Resource Manager API
    * IAM API
    * Cloud Logging API
    * Cloud Build API (Optional, for CI/CD)
3.  **Locally Installed Tools:**
    * Terraform CLI (`terraform`)
    * Google Cloud SDK (`gcloud`)
    * Node.js and `npm`
    * Docker Desktop or Docker Engine (`docker`)
4.  **Authentication:**
    * Authenticate `gcloud`: `gcloud auth login`
    * Set up Application Default Credentials (ADC): `gcloud auth application-default login`
    * Configure `gcloud` project: `gcloud config set project YOUR_PROJECT_ID`

## Setup & Deployment (via Terraform & Docker)

This process uses Terraform to provision the secure GCP infrastructure and Cloud Run service, then uses Docker to build and push the application container image.

1.  **Clone the Repository:**
    ```bash
    git clone <your-repo-url>
    cd vertex-proxy
    ```

2.  **Configure Terraform Variables:**
    Create a `terraform.tfvars` file in the `terraform/` directory or use `-var` flags during `plan/apply`. See `terraform/variables.tf` for all options. Key variables:

    | Variable         | Description                                                 | Example                  | Required |
    | :--------------- | :---------------------------------------------------------- | :----------------------- | :------- |
    | `project_id`     | Your GCP Project ID                                         | `my-gcp-project-123`     | Yes      |
    | `region`         | GCP Region for resources                                    | `europe-west1`           | No       |
    | `my_ip_address`  | Your public IP for firewall rule (`x.x.x.x/32`)             | `198.51.100.10/32`       | Yes      |
    | ... (other variables from variables.tf) ... |

3.  **Initialize Terraform:**
    ```bash
    cd terraform
    terraform init
    ```

4.  **Apply Initial Infrastructure:**
    This provisions the VPC, KMS keys, IAM roles, Artifact Registry, etc., and deploys Cloud Run with a placeholder image. Review the plan carefully.
    ```bash
    # Example using .tfvars file
    terraform plan -var-file="terraform.tfvars"
    terraform apply -var-file="terraform.tfvars"
    ```

5.  **Build & Push Application Container Image:**
    * Get your Artifact Registry repository URL (encrypted by CMEK):
        ```bash
        export REPO_URL=$(terraform output -raw artifact_registry_repository_url)
        echo "Repository URL: $REPO_URL"
        ```
    * Configure Docker authentication:
        ```bash
        gcloud auth configure-docker $(echo $REPO_URL | cut -d'/' -f1)
        ```
    * Navigate to the project root directory.
    * Build the image:
        ```bash
        docker build --platform linux/amd64 -t ${REPO_URL}/vertex-proxy:latest .
        ```
    * Push the image:
        ```bash
        docker push ${REPO_URL}/vertex-proxy:latest
        ```

6.  **Update Cloud Run Service with Your Image:**
    * Edit `terraform/main.tf`.
    * Locate the `resource "google_cloud_run_v2_service" "default"` block.
    * Update `template.containers[0].image` to use your pushed image path (e.g., `${REPO_URL}/vertex-proxy:latest`).
    * If present, remove the `lifecycle { ignore_changes = [...] }` block for the image if you want Terraform to manage future image updates.

7.  **Apply Terraform Update:**
    Run `terraform apply` again to update the Cloud Run service.
    ```bash
    terraform apply -var-file="terraform.tfvars"
    ```

## Configuration

* **Infrastructure:** GCP resources (VPC, KMS, etc.) are configured via Terraform variables (`terraform/variables.tf` or `terraform.tfvars`).
* **Application Behavior:** Key runtime parameters are passed to the Cloud Run service as **environment variables**, managed securely within the Terraform configuration (`terraform/main.tf`):
    * `EXPECTED_API_KEY`: The **secret API key** clients must send. **Set a strong, unique key.** (See Security Considerations re: Secret Manager).
    * `GCP_PROJECT_ID`, `GCP_REGION`, `VERTEX_AI_ENDPOINT`, `VERTEX_AI_MODEL_ID`: Define the target Vertex AI service.

## Usage

1.  **Get Service URL:**
    ```bash
    export SERVICE_URL=$(terraform output -raw cloud_run_service_url)
    echo "Service URL: $SERVICE_URL"
    ```

2.  **Test with `curl`:**
    Replace `YOUR_SECRET_API_KEY_HERE` with the key you set in Terraform.
    ```bash
    API_KEY="YOUR_SECRET_API_KEY_HERE"

    curl -X POST ${SERVICE_URL}/v1/chat \
      -H "X-API-Key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d '{
            "prompt": "Explain the benefits of using Cloud Run vs. managing VMs.",
            "history": []
          }'

    # Note: If you configured IAM-based invocation on Cloud Run, add:
    # -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
    ```

3.  **Client Configuration (e.g., Chatbox):**
    * **Endpoint URL:** Set the client's target URL to your deployed service URL (`${SERVICE_URL}/v1/chat`).
    * **Custom Header:** Configure the client to send the `X-API-Key` HTTP header with your defined secret key value.
    * **Request/Response Format:** Adjust the mapping logic in `src/server.js` if your client requires a specific request/response schema (e.g., mimicking OpenAI's format).

## Security Considerations

This project is designed with security in mind, leveraging GCP features:

* **IAM Identity (MOST IMPORTANT):** By running as a Cloud Run service with an assigned Service Account, this proxy authenticates to Vertex AI using GCP's secure, managed identity infrastructure. **This avoids the significant security risk of downloading, storing, and managing Service Account JSON key files.** Credentials are automatically handled and rotated by GCP.
* **VPC Network Confinement:** The Cloud Run service operates within your private VPC network, isolating it from the public internet by default (ingress/egress controlled by firewall rules and VPC settings). Private Google Access allows secure connections to Vertex AI endpoints without public IPs.
* **CMEK (Customer-Managed Encryption Keys):** Both the container image stored in Artifact Registry and the runtime state of the Cloud Run service are encrypted using a KMS key you control, adding a layer of data protection and compliance control.
* **Firewall Rules:** The Terraform setup includes a basic firewall rule restricting ingress to the specified `my_ip_address`. Harden this further for production using IAP, Load Balancer security policies, or more specific IP ranges.
* **API Key Management:** The current implementation uses an environment variable for the client API key for simplicity. **For production, strongly recommended:** Use **Google Secret Manager** to store the API key and grant the Cloud Run Service Account (`roles/secretmanager.secretAccessor`) permission to access it. Modify `server.js` to fetch the key from Secret Manager on startup.

## Troubleshooting / Logging

* Monitor service health and troubleshoot issues using **Cloud Logging** in the GCP Console. Filter logs by the Cloud Run service name (`var.cloud_run_service_name`).

## Future Improvements

* Integrate **Google Secret Manager** for `EXPECTED_API_KEY`.
* Implement more sophisticated **request/response transformation** logic.
* Enhance security with **Identity-Aware Proxy (IAP)**.
* Set up a **CI/CD pipeline** (e.g., Cloud Build) for automation.
* Add more comprehensive **error handling and monitoring/alerting**.

## Project Structure

```
vertex-gcp-proxy/
├── terraform/      # Terraform configurations
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── providers.tf
├── src/            # Node.js/TypeScript source code
│   └── server.ts
├── .gitignore
├── .vscode/        # VS Code settings (optional, ignored by git)
│   └── settings.json
├── Dockerfile      # Container definition
├── eslint.config.js # ESLint v9 configuration
├── package.json    # Node dependencies (managed by pnpm)
├── pnpm-lock.yaml  # pnpm lockfile
├── README.md       # This file
└── tsconfig.json   # TypeScript configuration
```

## Setup & Deployment

1.  **Configure Terraform Variables:**
    *   Create a `terraform/secrets.tfvars` file with your `project_id` and a `EXPECTED_API_KEY`:
        ```tfvars
        # terraform/secrets.tfvars
        project_id       = "YOUR_PROJECT_ID"
        EXPECTED_API_KEY = "YOUR_SECRET_API_KEY_HERE" # Use a strong, unique key
        ```
    *   **IMPORTANT:** Add `*.tfvars` to your `.gitignore` file.

2.  **Apply Infrastructure (Initial):**
    *   Navigate to the Terraform directory: `cd terraform`
    *   Initialize Terraform: `terraform init`
    *   Plan and apply:
        ```bash
        terraform plan -var-file="secrets.tfvars"
        terraform apply -var-file="secrets.tfvars"
        ```
    *   **Troubleshooting:** If the first `apply` fails with errors about service accounts (`...serverless-robot-prod...` or `...gcp-sa-artifactregistry...`) not existing, wait a minute and simply run `terraform apply -var-file="secrets.tfvars"` again. This is often a timing issue resolved by using `google_project_service_identity` resources.
    *   Navigate back to the project root: `cd ..`

3.  **Install Application Dependencies:**
    *   Run `pnpm install` in the project root:
        ```bash
        pnpm install
        ```

4.  **Build and Push Docker Image:**
    *   Get the Artifact Registry URL (run from project root):
        ```bash
        export REPO_URL=$(terraform -chdir=terraform output -raw artifact_registry_repository_url)
        echo "Repository URL: $REPO_URL"
        # Example output: <YOUR_REGION>-docker.pkg.dev/YOUR_PROJECT_ID/vertex-proxy-repo
        ```
    *   Configure Docker authentication:
        ```bash
        export REPO_HOST=$(echo $REPO_URL | cut -d'/' -f1)
        echo "Configuring auth for: $REPO_HOST"
        gcloud auth configure-docker $REPO_HOST
        ```
    *   Build the image (run from project root):
        ```bash
        # IMPORTANT: If building on an ARM machine (e.g., Apple Silicon Mac),
        # specify the target platform for Cloud Run (AMD64).
        docker build --platform linux/amd64 -t ${REPO_URL}/vertex-proxy:latest .
        ```
    *   **Troubleshooting Build:** If the build fails with TypeScript errors despite correct configuration, try forcing a build without cache: `docker build --no-cache --platform linux/amd64 -t ${REPO_URL}/vertex-proxy:latest .`. Use `--progress=plain` to see detailed build logs.
    *   Push the image:
        ```bash
        docker push ${REPO_URL}/vertex-proxy:latest
        ```
    *   **Troubleshooting Push:** If push fails with authentication errors, refresh your `gcloud` credentials: `gcloud auth login && gcloud auth application-default login` and retry the push.

5.  **Update Cloud Run Service (Deploy Image):**
    *   Navigate back to the Terraform directory: `cd terraform`
    *   Apply the changes again. Terraform detects the change in `main.tf` referencing the pushed image (or uses the timestamp label added for debugging) and updates the Cloud Run service:
        ```bash
        terraform apply -var-file="secrets.tfvars"
        ```
    *   Navigate back to the project root: `cd ..`

## Testing

*   Get the service URL:
    ```bash
    export SERVICE_URL=$(terraform -chdir=terraform output -raw cloud_run_service_url)
    echo "Service URL: $SERVICE_URL"
    ```
*   Get the API Key (from your `secrets.tfvars`):
    ```bash
    export API_KEY="YOUR_SECRET_API_KEY_HERE"
    ```
*   Make a test request using `curl`:
    ```bash
    # Note: Cloud Run often requires authentication (even if ingress allows all traffic)
    # due to Organization Policies. The Authorization header is likely required.
    curl -v -X POST ${SERVICE_URL}/v1/chat \
      -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
      -H "X-API-Key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d '{
            "prompt": "Hello Gemini, tell me a short joke.",
            "history": []
          }'
    ```
*   **Check Logs:** If requests fail, check Cloud Logging for the `Cloud Run Revision` resource, filtering for the latest revision of `vertex-proxy-service`.
*   **Model ID:** Ensure the `VERTEX_AI_MODEL_ID` environment variable in `terraform/main.tf` points to a model version available in your project/region (check Model Garden in Vertex AI console, e.g., `gemini-1.5-pro-002`).

## Development

*   Run the development server (auto-reloads on changes):
    ```bash
    pnpm run dev
    ```
*   Lint the code:
    ```bash
    pnpm run lint
    ```

## Phase 7: Refinements (TODO)

*   Use Secret Manager for `EXPECTED_API_KEY`.
*   Restrict Cloud Run Ingress / Firewall rules.
*   Improve response transformation/error handling in `server.ts`.
*   Set up CI/CD pipeline (e.g., Cloud Build).