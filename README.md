# Secure Cloud-Native Vertex AI Proxy (Cloud Run + API Gateway + Terraform)

## Description

This project provides a **secure, cloud-native proxy service** designed to run as a managed application on **Google Cloud Run**, fronted by **API Gateway**. It bridges the gap between client applications using simple static API Key authentication and Google Cloud's powerful Vertex AI Gemini endpoints, which require robust IAM-based authentication.

**Why this project?** While basic proxies might run locally or in Docker and require manual management of Service Account JSON keys, this solution offers significant advantages for users operating within the GCP ecosystem:

1.  **Secure Vertex AI Calls:** Leverages Cloud Run's **IAM runtime identity**, eliminating the need to download, manage, and secure risky Service Account key files. Authentication to Vertex AI happens securely within GCP's managed infrastructure.
2.  **Managed Infrastructure:** Deploys API Gateway and a scalable, serverless Cloud Run application, removing the burden of managing servers, patching OS, or configuring scaling.
3.  **Infrastructure as Code:** Provides a complete, production-ready infrastructure setup defined in **Terraform**, including VPC networking, firewall rules, KMS keys for CMEK, dedicated IAM service accounts, API Gateway, and Artifact Registry – ensuring reproducible and auditable deployments.
4.  **Application-Level Auth:** Uses a simple static API Key check within the Cloud Run application for client authentication.
5.  **Built-in Security Layers:** Integrates **VPC network confinement** for network isolation and **Customer-Managed Encryption Keys (CMEK)** for encrypting container images and runtime state, adhering to GCP security best practices.

The API Gateway routes requests to the Cloud Run service. The Cloud Run service receives requests with a predefined static API key in the `X-API-Key` header, validates it, and securely forwards the request to the configured Vertex AI Gemini endpoint using its integrated GCP identity.

## Key Differentiating Features

* **API Gateway Integration:** Uses API Gateway as the managed entry point.
* **Secure Vertex AI Authentication:** Translates client API Keys (validated by the backend) to Vertex AI calls authenticated via the Cloud Run service's **runtime IAM identity** (No downloaded service account keys needed).
* **Managed Cloud-Native Deployment:** Runs as a scalable, serverless application on **Google Cloud Run**.
* **Infrastructure as Code (Terraform):** Complete GCP infrastructure (VPC, Firewall, KMS, IAM, Cloud Run, API Gateway, Artifact Registry) defined and managed via Terraform for reproducible, secure deployments.
* **Enhanced Security Posture:**
    * Eliminates risks associated with managing exported Service Account JSON keys.
    * Includes **VPC network confinement** for network isolation.
    * Applies **Customer-Managed Encryption Keys (CMEK)** via Cloud KMS for Artifact Registry images and Cloud Run runtime state.
* **Node.js Proxy Logic:** Handles API key validation, calls the Vertex AI API (using `@google-cloud/aiplatform`), and provides a base for optional response transformation.

## Architecture Overview & Authentication Flow

1.  **Client:** Sends an HTTP request to the API Gateway endpoint (`*.gateway.dev`), including a static secret key in the `X-API-Key` header.
2.  **API Gateway:** Receives the request. It's configured as a simple pass-through (no built-in API Key or IAM check configured at the gateway level).
3.  **Cloud Run:** API Gateway forwards the request to the public Cloud Run endpoint (`*.run.app`).
    *   The Cloud Run service is configured with `ingress = all`.
    *   It allows unauthenticated *invocations* because the `allUsers` principal has been granted the `roles/run.invoker` role (requires specific Org Policy configuration, see below).
4.  **Application Code (`server.ts`):** The Node.js code running in Cloud Run:
    *   Receives the request.
    *   Validates the `X-API-Key` header against the `EXPECTED_API_KEY` environment variable.
    *   If valid, proceeds to call the Vertex AI API.
5.  **Vertex AI:** The call is authenticated using the **runtime service account identity** associated with the Cloud Run service (`cloud_run_sa`).
6.  **Response:** The response flows back through Cloud Run and API Gateway to the client.

## Technology Stack

* **Cloud Provider:** Google Cloud Platform (GCP)
* **Infrastructure as Code:** Terraform (~> 5.0)
* **API Management:** API Gateway
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
    * API Gateway API
    * Service Control API
    * Service Management API
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
    * Node.js and `pnpm` (or `npm`/`yarn` if preferred, adjust commands)
    * Docker Desktop or Docker Engine (`docker`)
4.  **Authentication:**
    * Authenticate `gcloud`: `gcloud auth login`
    * Set up Application Default Credentials (ADC): `gcloud auth application-default login`
    * Configure `gcloud` project: `gcloud config set project YOUR_PROJECT_ID`

## ⚠️ IMPORTANT: Organization Policy Prerequisite

This setup requires the Cloud Run service to allow **unauthenticated invocations**. This is achieved by granting the `roles/run.invoker` role to the special principal `allUsers` in the Terraform configuration (`google_cloud_run_v2_service_iam_member "allow_unauthenticated"`).

**Many organizations block this by default** using the Organization Policy **`constraints/iam.allowedPolicyMemberDomains`**. If this policy is active and restricts members to specific domains, the `terraform apply` command will fail with an error similar to:

```
Error: Error applying IAM policy for cloudrunv2 service ... googleapi: Error 400: One or more users named in the policy do not belong to a permitted customer...
```

**Resolution (Requires Organization Admin privileges):**

1.  Navigate to **IAM & Admin -> Organization Policies** in the GCP Console.
2.  Select your Organization.
3.  Find and select the **`Domain restricted sharing`** policy (`constraints/iam.allowedPolicyMemberDomains`).
4.  Click **EDIT**.
5.  Choose **"Customize"** (or "Manage Policy").
6.  For "Applies to", select **"Override parent's policy"** (or similar option to customize for a specific resource).
7.  Set the enforcement target to your specific **Project ID** (`YOUR_PROJECT_ID`).
8.  Configure the policy for this project override to **"Allow All"** or disable enforcement (effectively removing the domain restriction *only* for this project).
9.  **SAVE** the policy change.

**If you cannot modify the Organization Policy, this specific deployment approach will not work.** You would need to explore alternatives, such as requiring the client to send IAM Bearer tokens directly to Cloud Run (bypassing API Gateway) or implementing a more complex proxy mechanism.

## Setup & Deployment (via Terraform & Docker)

1.  **Clone the Repository:**
    ```bash
    git clone <your-repo-url>
    cd <repo-directory-name> # e.g., vertex-gcp-proxy
    ```

2.  **Configure Terraform Variables:**
    *   Create a `terraform/secrets.tfvars` file with your `project_id` and a **static secret API key** for client authentication:
        ```tfvars
        # terraform/secrets.tfvars
        project_id       = "YOUR_PROJECT_ID"
        # This is the static secret key the Node.js backend will check via X-API-Key header
        EXPECTED_API_KEY = "YOUR_SECRET_STATIC_API_KEY_HERE" # Use a strong, unique key
        ```
    *   **IMPORTANT:** Add `*.tfvars` to your `.gitignore` file.
    *   Review `terraform/variables.tf` for other optional configuration (region, names, etc.).

3.  **Initialize Terraform:**
    ```bash
    cd terraform
    terraform init
    ```

4.  **Apply Infrastructure:**
    Review the plan carefully. This provisions the VPC, KMS keys, IAM roles, Artifact Registry, API Gateway, and deploys Cloud Run (initially potentially with a default image or previous image).
    ```bash
    terraform plan -var-file="secrets.tfvars"
    terraform apply -var-file="secrets.tfvars"
    # If this fails with the Org Policy error, address the prerequisite above and retry.
    ```
    Navigate back to the project root: `cd ..`

5.  **Install Application Dependencies:**
    *   Use `pnpm` (or `npm`/`yarn`):
        ```bash
        pnpm install
        ```

6.  **Build & Push Application Container Image:**
    *   Get the Artifact Registry repository URL (run from project root):
        ```bash
        export REPO_URL=$(terraform -chdir=terraform output -raw artifact_registry_repository_url)
        echo "Repository URL: $REPO_URL"
        # Example output: <YOUR_REGION>-docker.pkg.dev/YOUR_PROJECT_ID/vertex-proxy-repo
        ```
    *   Configure Docker authentication:
        ```bash
        export REPO_HOST=$(echo $REPO_URL | cut -d'/' -f1)
        echo "Configuring auth for: $REPO_HOST"
        gcloud auth configure-docker $REPO_HOST --quiet
        ```
    *   Build the image (run from project root):
        ```bash
        # IMPORTANT: If building on an ARM machine (e.g., Apple Silicon Mac),
        # specify the target platform for Cloud Run (AMD64).
        docker build --platform linux/amd64 -t ${REPO_URL}/vertex-proxy:latest .
        ```
    *   Push the image:
        ```bash
        docker push ${REPO_URL}/vertex-proxy:latest
        ```

7.  **Update Cloud Run Service (Deploy Image):**
    *   Navigate back to the Terraform directory: `cd terraform`
    *   Apply the changes again. Terraform updates the Cloud Run service to use the newly pushed image.
        ```bash
        terraform apply -var-file="secrets.tfvars"
        ```
    *   Navigate back to the project root: `cd ..`

## Usage

1.  **Get API Gateway URL:**
    ```bash
    export SERVICE_URL="https://$(terraform -chdir=terraform output -raw api_gateway_url)"
    echo "API Gateway URL: $SERVICE_URL"
    ```

2.  **Test with `curl`:**
    Use the **static secret API key** you defined in `secrets.tfvars`.
    ```bash
    # Get the static key from your secrets.tfvars or set it directly
    export API_KEY="YOUR_SECRET_STATIC_API_KEY_HERE"

    curl -v -X POST ${SERVICE_URL}/v1/chat \
      -H "X-API-Key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d '{
            "prompt": "Explain the benefits of using Cloud Run vs. managing VMs.",
            "history": []
          }'
    ```

3.  **Client Configuration (e.g., Chatbox):**
    * **Endpoint URL:** Set the client's target URL to your deployed **API Gateway URL** (`${SERVICE_URL}/v1/chat`).
    * **Custom Header:** Configure the client to send the `X-API-Key` HTTP header with your defined static secret key value.
    * **Request/Response Format:** Adjust the mapping logic in `src/server.ts` if your client requires a specific request/response schema.

## Security Considerations

This project leverages several GCP security features:

* **IAM Identity for Vertex AI:** Cloud Run authenticates to Vertex AI using its managed identity, avoiding insecure Service Account key files.
* **VPC Network Confinement:** The Cloud Run service operates within your private VPC.
* **CMEK:** Container images and runtime state are encrypted using your KMS key.
* **Application-Level Authentication:** Client authentication relies on the **static API key check within `server.ts`**. Since Cloud Run allows unauthenticated invocations in this setup (due to the Org Policy workaround), **this check is critical**. Ensure the key is strong and kept secret.
* **API Key Management:** The current implementation uses an environment variable for the client API key. **For production, strongly recommended:** Use **Google Secret Manager** to store the static API key and grant the Cloud Run Service Account (`roles/secretmanager.secretAccessor`) permission to access it. Modify `server.ts` to fetch the key from Secret Manager on startup.
* **Firewall Rules:** The basic firewall rule only allows access to the VPC for specific IPs. Review and harden as needed.
* **API Gateway:** In this configuration, API Gateway primarily acts as a router and managed endpoint, **not** as an authentication layer itself.

## Troubleshooting / Logging

* Monitor service health and troubleshoot issues using **Cloud Logging** in the GCP Console. Filter logs by the Cloud Run service name (`var.cloud_run_service_name`) or the API Gateway resource.
* If `terraform apply` fails due to the Org Policy, see the **IMPORTANT: Organization Policy Prerequisite** section above.
* If requests succeed directly to Cloud Run but fail at API Gateway, check the API Gateway logs and ensure the `openapi.yaml` configuration is correctly applied.

## Future Improvements

* Integrate **Google Secret Manager** for `EXPECTED_API_KEY`.
* Implement more sophisticated **request/response transformation** logic.
* Add **rate limiting or quotas** via API Gateway (would require re-enabling API key validation at gateway using GCP keys).
* Enhance security with **Identity-Aware Proxy (IAP)** if client authentication needs upgrading beyond a static key.
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
│   └── secrets.tfvars # (GITIGNORED!) For sensitive variables
├── src/            # Node.js/TypeScript source code
│   └── server.ts
├── .gitignore
├── .vscode/        # VS Code settings (optional, ignored by git)
│   └── settings.json
├── openapi.yaml    # OpenAPI spec for API Gateway
├── Dockerfile      # Container definition
├── eslint.config.js # ESLint v9 configuration
├── package.json    # Node dependencies (managed by pnpm)
├── pnpm-lock.yaml  # pnpm lockfile
├── README.md       # This file
└── tsconfig.json   # TypeScript configuration
```

## Development

*   Run the development server (auto-reloads on changes):
    ```bash
    # Ensure EXPECTED_API_KEY is set as an environment variable locally for testing
    export EXPECTED_API_KEY="your-dev-key"
    pnpm run dev
    ```
*   Lint the code:
    ```bash
    pnpm run lint
    ```