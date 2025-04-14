#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chatCommand } from './commands/chat.js';
import { streamChatCommand } from './commands/stream.js';

// Get current directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load environment variables from multiple possible locations
const envPaths = [
  path.join(process.cwd(), '.env'),  // Project root
  path.join(process.cwd(), 'src/cli/.env'),  // Source CLI directory
  path.join(__dirname, '.env')  // Build output directory (relative to this file's location)
];

// Find the first .env file that exists
let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    console.log(`Loading environment from: ${envPath}`);
    const result = dotenv.config({ path: envPath });
    
    if (result.error) {
      console.error(`Error loading ${envPath}:`, result.error);
    } else {
      console.log('Environment variables loaded successfully');
      console.log(`GRPC_TARGET = ${process.env.GRPC_TARGET}`);
      console.log(`API_KEY = ${process.env.API_KEY ? '****' + process.env.API_KEY.slice(-4) : 'undefined'}`);
      envLoaded = true;
      break;
    }
  }
}

if (!envLoaded) {
  console.warn('Warning: No .env file found');
}

// Verify gRPC configuration is available
if (!process.env.GRPC_TARGET || !process.env.API_KEY) {
  console.error('Error: Environment variables GRPC_TARGET and API_KEY must be set.');
  console.error('Create a .env file in the project root or src/cli/ directory with:');
  console.error('GRPC_TARGET=your-cloud-run-service-url:443');
  console.error('API_KEY=your-api-key');
  process.exit(1);
}

const program = new Command();

program
  .name('vertex-cli')
  .description('CLI for interacting with Vertex AI gRPC proxy')
  .version('1.0.0');

// Register commands
chatCommand(program);
streamChatCommand(program);

program.parse(process.argv);
