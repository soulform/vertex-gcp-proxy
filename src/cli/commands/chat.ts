import { Command } from 'commander';
import chalk from 'chalk';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';

// Helper function to create gRPC client
const createGrpcClient = (target: string, apiKey: string) => {
    const __filename = fileURLToPath(import.meta.url);
    // Go up THREE levels from commands/chat.js to project root src/, then proto/
    const PROTO_PATH = path.join(__filename, '..', '..', '..', 'proto/vertex_proxy.proto'); 

    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
    });
    const vertexProxyProto = grpc.loadPackageDefinition(packageDefinition).vertexproxy as any;

    // Add API Key metadata
    const metadata = new grpc.Metadata();
    metadata.add('x-api-key', apiKey);

    // Create credentials (secure for Cloud Run URL)
    const credentials = grpc.credentials.createSsl();

    // Create client
    const client = new vertexProxyProto.VertexProxy(target, credentials);
    
    return { client, metadata };
};

// Define the structure for history items based on the proto definition
interface ProtoHistoryItem {
    role: 'user' | 'model';
    parts: { text: string }[];
}

export function chatCommand(program: Command): void {
  program
    .command('chat')
    .description('Chat with the proxied Vertex AI model via gRPC')
    .option('-i, --interactive', 'Start an interactive chat session')
    .option('-p, --prompt <prompt>', 'Single prompt to send')
    .action(async (options) => {
        const GRPC_TARGET = process.env.GRPC_TARGET;
        const API_KEY = process.env.API_KEY;

        if (!GRPC_TARGET || !API_KEY) {
            console.error(chalk.red('Error: GRPC_TARGET and API_KEY must be set in .env and loaded correctly.'));
            process.exit(1);
        }

        const { client, metadata } = createGrpcClient(GRPC_TARGET, API_KEY);

        if (options.interactive) {
            await startInteractiveChat(client, metadata); 
        } else if (options.prompt) {
            await sendSinglePrompt(client, metadata, options.prompt);
        } else {
            console.log(chalk.yellow('Please provide a prompt (-p) or use interactive mode (-i).'));
            program.help();
        }
    });
}

async function sendSinglePrompt(client: any, metadata: grpc.Metadata, prompt: string): Promise<void> {
  try {
    console.log(chalk.blue('User: ') + prompt);

    const request = {
      prompt: prompt,
      history: [] // No history for single prompt
    };

    await new Promise<void>((resolve, reject) => {
        client.chat(request, metadata, (err: grpc.ServiceError | null, response: any) => {
            if (err) {
                console.error(chalk.red('gRPC Error:'), err.details || err.message);
                reject(err);
            } else if (response.error) {
                console.error(chalk.red('Proxy Server Error:'), response.error);
                resolve(); // Resolve even on server error to avoid hanging
            } else {
                 // Extract text from the first candidate's first part
                const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;
                if (responseText) {
                    console.log(chalk.green('Model: ') + responseText);
                } else {
                    console.warn(chalk.yellow('Model response format unexpected or empty.'), JSON.stringify(response, null, 2));
                }
                resolve();
            }
        });
    });

  } catch (error) {
    // Error is logged within the callback
    console.error(chalk.red('Failed to send gRPC request.'));
  }
}

// Interactive chat using prompts library
async function startInteractiveChat(client: any, metadata: grpc.Metadata): Promise<void> {
    console.log(chalk.cyan('Starting interactive gRPC chat session. Press Ctrl+C to exit.'));
    const history: ProtoHistoryItem[] = []; // Restore history array

    try {
        // Restore the while loop
        while (true) { 
            const response = await prompts({
                type: 'text',
                name: 'input',
                message: chalk.blue('User: ')
                // Removed onCancel
            });
            
            // Remove debug log
            // console.log('[DEBUG: prompts response:]', response);

            if (response.input === undefined) { 
                 console.log(chalk.cyan('\nExiting chat session (input cancelled or invalid).'));
                 break; // Exit the loop
            }

            const input = response.input.trim();
            // Remove debug log
            // console.log(`Input received: "${input}"`);

            if (!input) {
                 // Remove debug log
                 // console.log('Empty input received.')
                 continue; // Ask again if empty
            }
            
            // Restore gRPC call logic
            const userMessage: ProtoHistoryItem = { role: 'user', parts: [{ text: input }] };
            const request = { prompt: input, history: history };
            
            try {
                 const grpcResponse = await new Promise<any>((resolve, reject) => {
                    client.chat(request, metadata, (err: grpc.ServiceError | null, response: any) => {
                         if (err) { reject(err); } 
                         else { resolve(response); }
                    });
                 });

                 const responseText = grpcResponse.candidates?.[0]?.content?.parts?.[0]?.text;
                 if (responseText) {
                     console.log(chalk.green('Model: ') + responseText);
                     history.push(userMessage);
                     history.push({ role: 'model', parts: [{ text: responseText }] });
                 } else if (!grpcResponse.error) { 
                     console.warn(chalk.yellow('Model response format unexpected or empty.'), JSON.stringify(grpcResponse, null, 2));
                     history.push(userMessage);
                 } else {
                     console.error(chalk.red('Proxy Server Error:'), grpcResponse.error);
                     history.push(userMessage); // Store user message even if server erred
                 }

            } catch (grpcError: any) {
                 console.error(chalk.red('gRPC Error:'), grpcError.details || grpcError.message);
                 // break; // Optionally break loop on error
            }
            // --- End of restored logic ---

        } // End while loop
    } catch (error) {
        console.error(chalk.red('An unexpected error occurred:'), error);
    }
    // Remove debug log
    // console.log('Function end.');
}
