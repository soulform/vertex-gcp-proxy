# ---- Base Node ----
# Use a specific LTS version for reproducibility
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm

# ---- Builder ----
# Used to install dependencies and build the TypeScript source
FROM base AS builder
WORKDIR /usr/src/app

# Install pnpm
# RUN npm install -g pnpm

# Copy package management files
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (including devDependencies needed for build)
RUN pnpm install --frozen-lockfile

# Copy the rest of the application source code
COPY . .

# ---- Add Debugging Steps ----
RUN echo "--- Checking tsconfig.json contents: ---" && cat tsconfig.json
RUN echo "--- Checking tsc version: ---" && pnpm exec tsc --version
# -----------------------------

# Build the TypeScript code
RUN pnpm run build
# Prune dev dependencies after build
RUN pnpm prune --prod

# ---- Runner ----
# Final, smaller image with only production dependencies and built code
FROM base AS runner
WORKDIR /usr/src/app

# Copy production node_modules and built code from builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist

# Make port 8080 available (matches server.ts and Terraform firewall/Cloud Run)
EXPOSE 8080

# Define the command to run the application
# Executes the compiled JavaScript code
CMD [ "node", "dist/server.js" ] 