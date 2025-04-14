# Secure Cloud-Native Vertex AI gRPC Proxy (Cloud Run + Terraform)

## Description

This project provides a **secure, cloud-native gRPC proxy service** designed to run as a managed application on **Google Cloud Run**. It solves the common challenge of exposing Google Cloud's powerful Vertex AI Gemini endpoints, which require robust IAM-based authentication, to clients that prefer or require simpler static API Key authentication (sent via gRPC metadata).

**Why this project? What problems does it solve?**

While you can use SDKs like the Vercel AI SDK (`@ai-sdk/google-vertex`) to call Vertex AI directly using GCP authentication, this proxy offers an alternative pattern:

1.  **Simplified Client Authentication:** The primary goal is to enable clients (scripts, apps) to access Vertex AI using only a **static API key** (`x-api-key` gRPC metadata header). This significantly lowers the barrier to entry compared to implementing full GCP authentication flows on the client-side.
2.  **Secure Server-Side Authentication:** The proxy leverages Cloud Run's **IAM runtime identity** to securely authenticate calls to Vertex AI. This eliminates the need for clients to possess GCP credentials and avoids the security risks of managing and distributing Service Account key files.
3.  **Centralized Control & Abstraction:** The Cloud Run gRPC proxy acts as a dedicated control point:
    *   **Validation & Guardrails:** Implement custom validation or logic (e.g., prompt size limits) before hitting the LLM.
    *   **Model Abstraction:** Change the backend Vertex AI model (`VERTEX_AI_MODEL_ID` in `server.ts`) without clients needing updates.
    *   **Security Boundary:** Limits direct exposure of your GCP project and Vertex AI resources.
4.  **Robust Streaming:** Uses **gRPC streaming** natively, which is generally more reliable and efficient for server-to-client streaming on Cloud Run compared to SSE over HTTP, potentially avoiding buffering issues seen with HTTP proxies.
5.  **Managed Cloud-Native Infrastructure:** Deploys a scalable, serverless Cloud Run application using **Terraform**, removing the burden of server management and ensuring reproducible, auditable infrastructure (VPC, Firewall, KMS/CMEK, IAM, Artifact Registry).
6.  **Enhanced Security Layers:** Integrates **VPC network confinement** and **Customer-Managed Encryption Keys (CMEK)** for Artifact Registry and Cloud Run runtime state, adhering to GCP best practices.

## Architecture Overview & Authentication Flow

1.  **Client (gRPC):** Sends a gRPC request directly to the Cloud Run endpoint (`*.run.app:443`), including a static secret key in the `x-api-key` metadata header.
2.  **Cloud Run:** The Cloud Run service receives the gRPC request.
    *   The service has `ingress = all` and allows unauthenticated invocations (requires Org Policy config).
3.  **Application Code (`server.ts`):** The Node.js/gRPC app in Cloud Run:
    *   Receives the request.
    *   Reads the `x-api-key` from the gRPC metadata.
    *   Validates the key against the `EXPECTED_API_KEY` environment variable (fetched securely, see Security Considerations).
    *   If valid, constructs the request for Vertex AI.
4.  **Vertex AI:** The Cloud Run service calls the Vertex AI API (unary or streaming), authenticating securely using its **runtime service account identity** (`cloud_run_sa`) which has the necessary `roles/aiplatform.user` permission.
5.  **Response:** The response (unary or gRPC stream) flows back directly to the client.

## Technology Stack

* **Cloud Provider:** Google Cloud Platform (GCP)
* **Infrastructure as Code:** Terraform (~> 5.0)
* **Compute:** Cloud Run (v2) - *Managed & Serverless (Gen2 required)*
* **Networking:** VPC Network, Cloud Firewall - *Secure Isolation*
* **Security:** IAM Service Accounts, Key Management Service (KMS) - *CMEK & Secure Identity*, Secret Manager (*Recommended*)
* **Containerization:** Docker, Artifact Registry - *CMEK Encrypted*
* **Application Runtime:** Node.js (v20+)
* **RPC Framework:** gRPC (`@grpc/grpc-js`, `@grpc/proto-loader`)
* **Interface Definition:** Protocol Buffers (`.proto`)
* **GCP SDK (Server):** `@google-cloud/vertexai` (Node.js)
* **CLI gRPC Client:** `@grpc/grpc-js`
* **CLI Interactive Prompts:** `prompts` (for user-friendly interactive input)
* **CLI Runner:** `tsx`

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
    * Secret Manager API (*Recommended*)
    * Cloud Build API (Optional, for CI/CD)
    * Service Control API (May still be needed by underlying services)
3.  **Locally Installed Tools:**
    * Terraform CLI (`terraform`)
    * Google Cloud SDK (`gcloud`)
    * Node.js (v20+) and `pnpm`
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
    *   Create a `terraform/secrets.tfvars` file with your `project_id` and the static secret API key:
        ```tfvars
        # terraform/secrets.tfvars
        project_id       = "YOUR_PROJECT_ID"
        # This is the static secret key the gRPC backend will check via x-api-key metadata
        # For production, consider using Secret Manager instead of putting the key here.
        EXPECTED_API_KEY = "YOUR_SECRET_STATIC_API_KEY_HERE" # Use a strong, unique key
        ```
    *   **IMPORTANT:** Add `*.tfvars` to your `.gitignore` file.
    *   Review `terraform/variables.tf` for other optional configuration.

3.  **Initialize Terraform:**
    ```bash
    cd terraform
    terraform init
    ```

4.  **Apply Infrastructure:**
    Review the plan carefully. This provisions the VPC, KMS keys, IAM roles, Artifact Registry, and deploys Cloud Run (initially potentially with a default image or previous image).
    ```bash
    terraform plan -var-file="secrets.tfvars"
    terraform apply -var-file="secrets.tfvars"
    # If this fails with the Org Policy error, address the prerequisite above and retry.
    ```
    Navigate back to the project root: `cd ..`

5.  **Install Application Dependencies:**
    *   Use `pnpm` (ensure you have Node.js v20+):
        ```bash
        pnpm install
        ```

6.  **Build & Push Application Container Image:**
    *   Get the Artifact Registry repository URL (run from project root):
        ```bash
        export REPO_URL=$(terraform -chdir=terraform output -raw artifact_registry_repository_url)
        echo "Repository URL: $REPO_URL"
        ```
    *   Configure Docker authentication:
        ```bash
        export REPO_HOST=$(echo $REPO_URL | cut -d'/' -f1)
        echo "Configuring auth for: $REPO_HOST"
        gcloud auth configure-docker $REPO_HOST --quiet
        ```
    *   Build the image (run from project root):
        ```bash
        # Ensure Dockerfile uses Gen2 base image if necessary, though node:20-slim should work
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

1.  **Get Cloud Run Service URL:**
    ```bash
    export SERVICE_RAW_URL=$(terraform -chdir=terraform output -raw cloud_run_service_url)
    # Construct the gRPC target (hostname:port)
    export GRPC_TARGET=$(echo $SERVICE_RAW_URL | sed 's|https://||g'):443 
    echo "gRPC Target: $GRPC_TARGET"
    ```

2.  **Test with CLI:** (See CLI Usage section below for setup)
    Use the **static secret API key** you defined in `secrets.tfvars` (set in `src/cli/.env`).
    ```bash
    pnpm run cli:chat -p "Explain gRPC streaming."
    pnpm run cli:stream -p "Tell me a short story using gRPC streaming."
    ```

3.  **Client Configuration:**
    *   **Target Address:** Configure your gRPC client to connect to the Cloud Run service hostname on port 443 (e.g., `your-service-name-....run.app:443`).
    *   **Credentials:** Use standard TLS/SSL credentials (e.g., `grpc.credentials.createSsl()` in Node.js). Cloud Run's frontend provides the TLS termination.
    *   **Metadata:** Send the static API key in the `x-api-key` metadata header.
    *   **Protobuf:** Use the `src/proto/vertex_proxy.proto` definition to generate client stubs or load it dynamically.

## Security Considerations

*   **IAM Identity for Vertex AI:** Cloud Run authenticates to Vertex AI using its managed identity.
*   **VPC Network Confinement:** Cloud Run operates within your private VPC.
*   **CMEK:** Container images and runtime state are encrypted.
*   **Application-Level Authentication:** Client authentication relies *entirely* on the **static API key check within the gRPC server (`server.ts`)**, reading the `x-api-key` metadata. Since Cloud Run allows unauthenticated *network* invocations in this setup, **this check is critical**. Ensure the key is strong and kept secret.
*   **API Key Management:** The current implementation uses an environment variable (set via Terraform variable) for the client API key. **For production, strongly recommended:** Use **Google Secret Manager** to store the static API key and grant the Cloud Run Service Account (`roles/secretmanager.secretAccessor`) permission to access it. Modify `server.ts` to fetch the key from Secret Manager on startup instead of relying on `process.env.EXPECTED_API_KEY`.
*   **Firewall Rules:** The basic firewall rule allows ingress from all sources to the VPC on the service port. Review and harden as needed (e.g., restrict `source_ranges`).

## Troubleshooting / Logging

*   Monitor service health and troubleshoot issues using **Cloud Logging** in the GCP Console. Filter logs by the Cloud Run service name (`var.cloud_run_service_name`).
*   If `terraform apply` fails due to the Org Policy, see the **IMPORTANT: Organization Policy Prerequisite** section above.
*   If gRPC connections fail, ensure the target address (`hostname:443`) is correct, TLS credentials are used, and the `x-api-key` metadata is being sent.
*   Check server logs for API key validation errors or issues calling the Vertex AI API.

## Alternative Architecture Considered: API Gateway with gRPC Passthrough

While the `main` branch connects gRPC clients directly to the Cloud Run service for potentially better streaming performance, an attempt was made to reintroduce API Gateway in front of the gRPC backend. This was explored primarily to leverage API Gateway features like rate limiting, managed monitoring, and potentially avoiding the `allUsers` invoke permission on Cloud Run (by having the Gateway authenticate to an internal Cloud Run service using its service account).

The goal was **native gRPC passthrough**: `Client (gRPC) -> API Gateway -> Cloud Run (gRPC)`.

However, configuring API Gateway for this pattern proved problematic:

1.  **Initial OpenAPI Attempt:** Using a minimal OpenAPI specification to define the Cloud Run gRPC backend resulted in `404 Not Found` errors from API Gateway, indicating it couldn't route the specific gRPC method paths (e.g., `/vertexproxy.VertexProxy/Chat`) based solely on the OpenAPI definition.
2.  **gRPC Service Config Attempt:** Switching the Terraform configuration (`google_api_gateway_api_config`) to use the `grpc_services` block (with a proto descriptor set and a `grpc_service_config.yaml`) also failed during Terraform deployment. Errors indicated issues with missing backend rules or duplicate configuration source paths, suggesting that native gRPC passthrough configured this way is either unsupported or requires a more complex, non-obvious setup.

**Transcoding Alternative:** The standard, documented approach for API Gateway with gRPC backends is HTTP/JSON transcoding (`Client (HTTP) -> API Gateway -> Cloud Run (gRPC)`). This was not pursued in the `main` branch because:
    a) It might reintroduce the streaming buffering issues that the switch to native gRPC aimed to solve.
    b) It requires clients to use HTTP/SSE again, reverting the client-side implementation.

**Conclusion:** Due to the configuration difficulties with native gRPC passthrough, the `main` branch retains the direct Cloud Run connection. This prioritizes the direct gRPC communication path at the expense of built-in API Gateway features.

**The code demonstrating the attempt to configure API Gateway with the `grpc_services` block (Point 2 above) can be found in the `feat/api-gateway` branch.**

## Future Improvements

*   Integrate **Google Secret Manager** for `EXPECTED_API_KEY`.
*   Implement more sophisticated **request/response transformation** logic.
*   Enhance security by requiring **Google Cloud IAM authentication** for clients (e.g., sending ID tokens in metadata) instead of `allUsers` invoke + static key, if clients can support it.
*   Set up a **CI/CD pipeline** (e.g., Cloud Build).
*   Add **unit and integration tests** for the gRPC server (`server.ts`).
*   Add **gRPC health checks**.

## Project Structure

```
vertex-gcp-proxy/
├── terraform/          # Terraform configurations
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── providers.tf
│   └── secrets.tfvars  # (GITIGNORED!) For sensitive variables
├── src/                # Node.js/TypeScript source code
│   ├── server.ts       # Main gRPC server implementation
│   ├── proto/          # Protocol Buffer definitions
│   │   └── vertex_proxy.proto
│   └── cli/            # Command-line interface (gRPC client)
│       ├── index.ts    # CLI entry point
│       ├── commands/   # CLI command implementations
│       │   ├── chat.ts # uses @grpc/grpc-js and prompts
│       │   └── stream.ts # uses @grpc/grpc-js and prompts
│       ├── .env        # (GITIGNORED!) gRPC Target/Key for CLI
│       └── .env.example # Example environment variables for CLI
├── .gitignore
├── .vscode/            # VS Code settings (optional, ignored by git)
│   └── settings.json
├── Dockerfile          # Container definition
├── eslint.config.js    # ESLint v9 configuration
├── package.json        # Node dependencies (managed by pnpm)
├── pnpm-lock.yaml      # pnpm lockfile
├── README.md           # This file
└── tsconfig.json       # TypeScript configuration
```

## Development

*   Run the development gRPC server (auto-reloads on changes using `tsx`):
    ```bash
    # Ensure EXPECTED_API_KEY is set as an environment variable locally for testing
    export EXPECTED_API_KEY="your-dev-key"
    pnpm run dev
    ```
*   Lint the code:
    ```bash
    pnpm run lint
    ```

## CLI Usage

The project includes a command-line interface (`src/cli/`) for interacting with the deployed Vertex AI gRPC proxy. Interactive modes (`-i`) use the `prompts` library for a robust user experience.

1.  **Setup:**
    *   Copy the CLI environment file:
        ```bash
        cp src/cli/.env.example src/cli/.env
        ```
    *   Edit the `src/cli/.env` file with your deployed **Cloud Run gRPC Target** (e.g., `your-service-...run.app:443`) and the static API key:
        ```dotenv
        # src/cli/.env
        # Get from 'terraform output -raw cloud_run_service_url' and append :443
        GRPC_TARGET=your-service-name-....run.app:443 
        API_KEY=YOUR_SECRET_STATIC_API_KEY_HERE
        ```

2.  **Run the CLI (using `tsx` for direct TS execution):**
    *   Send a single prompt (unary gRPC):
        ```bash
        pnpm run cli:chat -p "What is Cloud Run?"
        ```
    *   Start an interactive chat session (unary gRPC):
        ```bash
        pnpm run cli:chat -i
        ```
    *   Send a single prompt with streaming response (streaming gRPC):
        ```bash
        pnpm run cli:stream -p "Explain Vertex AI Gemini in detail via gRPC stream"
        ```
    *   Start an interactive chat session with streaming responses (streaming gRPC):
        ```bash
        pnpm run cli:stream -i
        ```

3.  **(Optional) Install the CLI globally:**
    *   Build the project first (creates JavaScript output in `dist/`):
        ```bash
        pnpm run build
        ```
    *   Link the package globally:
        ```bash
        # Navigate to the project root directory first
        npm link
        ```
    *   Now you can use it from anywhere (requires `src/cli/.env` file to be present relative to execution, or vars set globally):
        ```bash
        vertex-cli chat -p "Hello, Gemini via gRPC!"
        ```