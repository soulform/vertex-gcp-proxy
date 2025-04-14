# ---- Base Stage ----
FROM node:20-slim AS base
WORKDIR /usr/src/app

# Install pnpm globally
RUN npm install -g pnpm

# Install necessary build tools if needed (e.g., for native modules)
# RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*


# ---- Dependencies Stage ----
FROM base AS deps
WORKDIR /usr/src/app

# Copy only dependency-related files
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies using pnpm
RUN pnpm install --prod --frozen-lockfile


# ---- Build Stage ----
FROM base AS build
WORKDIR /usr/src/app

# Copy dependency-related files and install ALL dependencies (incl. dev)
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# Copy the rest of the application source code
COPY . .

# Build the TypeScript code
RUN pnpm run build

# Prune development dependencies
RUN pnpm prune --prod


# ---- Final Stage ----
FROM base AS final
WORKDIR /usr/src/app

# Copy production dependencies from the 'deps' stage
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy the built application code from the 'build' stage
COPY --from=build /usr/src/app/dist ./dist
# Copy protobuf definitions into the correct location relative to dist/
COPY --from=build /usr/src/app/src/proto ./dist/proto

# Set environment variables (can be overridden at runtime)
ENV NODE_ENV=production
# PORT is exposed by Cloud Run automatically
# EXPECTED_API_KEY, GCP_PROJECT_ID, GCP_REGION, VERTEX_AI_MODEL_ID should be set by Cloud Run env vars

# Expose the port the app listens on (gRPC typically uses standard ports, but 8080 is common for Cloud Run)
EXPOSE 8080

# Command to run the gRPC server
CMD [ "node", "dist/server.js" ]