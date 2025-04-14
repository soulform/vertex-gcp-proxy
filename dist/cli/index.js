#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const chat_1 = require("./commands/chat");
const stream_1 = require("./commands/stream");
// Try to load environment variables from multiple possible locations
const envPaths = [
    path.join(process.cwd(), '.env'), // Project root
    path.join(process.cwd(), 'src/cli/.env'), // Source CLI directory
    path.join(__dirname, '.env') // Build output directory
];
// Find the first .env file that exists
let envLoaded = false;
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        console.log(`Loading environment from: ${envPath}`);
        const result = dotenv.config({ path: envPath });
        if (result.error) {
            console.error(`Error loading ${envPath}:`, result.error);
        }
        else {
            console.log('Environment variables loaded successfully');
            console.log(`API_URL = ${process.env.API_URL}`);
            console.log(`API_KEY = ${process.env.API_KEY ? '****' + process.env.API_KEY.slice(-4) : 'undefined'}`);
            envLoaded = true;
            break;
        }
    }
}
if (!envLoaded) {
    console.warn('Warning: No .env file found');
}
// Verify API configuration is available
if (!process.env.API_URL || !process.env.API_KEY) {
    console.error('Error: Environment variables API_URL and API_KEY must be set.');
    console.error('Create a .env file in the project root or src/cli/ directory with:');
    console.error('API_URL=https://your-api-gateway-url');
    console.error('API_KEY=your-api-key');
    process.exit(1);
}
const program = new commander_1.Command();
program
    .name('vertex-cli')
    .description('CLI for interacting with Vertex AI proxy')
    .version('1.0.0');
// Register commands
(0, chat_1.chatCommand)(program);
(0, stream_1.streamChatCommand)(program);
program.parse(process.argv);
//# sourceMappingURL=index.js.map