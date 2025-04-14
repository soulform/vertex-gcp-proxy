import { Command } from 'commander';
import chalk from 'chalk';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';

// REMOVE top-level access to process.env
// const API_URL = process.env.API_URL;
// const API_KEY = process.env.API_KEY;

// Shared helper function from chat.ts or define locally
const createGrpcClient = (target: string, apiKey: string) => {
    const __filename = fileURLToPath(import.meta.url);
    // Go up THREE levels from commands/stream.js to project root src/, then proto/
    const PROTO_PATH = path.join(__filename, '..', '..', '..', 'proto/vertex_proxy.proto'); 

    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
        keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
    });
    const vertexProxyProto = grpc.loadPackageDefinition(packageDefinition).vertexproxy as any;

    const metadata = new grpc.Metadata();
    metadata.add('x-api-key', apiKey);
    const credentials = grpc.credentials.createSsl();
    const client = new vertexProxyProto.VertexProxy(target, credentials);
    return { client, metadata };
};

// Define the structure for history items based on the proto definition
interface ProtoHistoryItem {
    role: 'user' | 'model';
    parts: { text: string }[];
}

export function streamChatCommand(program: Command): void {
  program
    .command('stream')
    .description('Chat with the proxied Vertex AI model using gRPC streaming')
    .option('-i, --interactive', 'Start an interactive streaming chat session')
    .option('-p, --prompt <prompt>', 'Single prompt to send with streaming response')
    .action(async (options) => {
      const GRPC_TARGET = process.env.GRPC_TARGET;
      const API_KEY = process.env.API_KEY;

      if (!GRPC_TARGET || !API_KEY) {
        console.error(chalk.red('Error: GRPC_TARGET and API_KEY must be set in .env and loaded correctly.'));
        process.exit(1);
      }
      const { client, metadata } = createGrpcClient(GRPC_TARGET, API_KEY);

      if (options.interactive) {
        await startInteractiveStreamingChat(client, metadata);
      } else if (options.prompt) {
        await sendStreamingPrompt(client, metadata, options.prompt);
      } else {
        console.log(chalk.yellow('Please provide a prompt (-p) or use interactive mode (-i).'));
        program.help();
      }
    });
}

// Refactored to use gRPC streaming call
async function sendStreamingPrompt(client: any, metadata: grpc.Metadata, prompt: string): Promise<void> {
    console.log(chalk.blue('User: ') + prompt);
    console.log(chalk.green('Model: ')); // Print header before streaming starts

    const request = {
      prompt: prompt,
      history: [], // No history for single prompt
    };

    const call = client.streamChat(request, metadata);

    return new Promise<void>((resolve, reject) => {
        call.on('data', (chunk: any) => {
            if (chunk.error) {
                console.error(chalk.red(`\nServer Stream Error: ${chunk.error}`));
                // Continue processing other potential chunks? Or cancel?
            } else if (chunk.text_chunk) {
                process.stdout.write(chunk.text_chunk); // Stream chunk to stdout
            }

            if (chunk.is_final_chunk) {
                console.log(); // Final newline
                 if (chunk.finish_reason && chunk.finish_reason !== 'STOP') {
                     console.warn(chalk.yellow(`\nStream finished with reason: ${chunk.finish_reason}`));
                 }
            }
        });
        call.on('end', () => {
            console.log(); // Ensure newline if stream ends abruptly
            resolve();
        });
        call.on('error', (err: grpc.ServiceError) => {
            console.error(chalk.red('\ngRPC Stream Error:'), err.details || err.message);
            reject(err);
        });
         call.on('status', (status: grpc.StatusObject) => {
            if (status.code !== grpc.status.OK) {
                console.error(chalk.yellow(`\ngRPC Stream Status Error: ${status.details}`));
                // Might already be handled by 'error' event, but good for info
            }
        });
    });
}

// Interactive streaming chat using prompts library
async function startInteractiveStreamingChat(client: any, metadata: grpc.Metadata): Promise<void> {
    console.log(chalk.cyan('Starting interactive gRPC streaming chat session. Press Ctrl+C to exit.'));
    const history: ProtoHistoryItem[] = [];
    let currentCall: grpc.ClientReadableStream<any> | null = null;

    try {
        while(true) {
            // Cancel previous call before asking new question
            if (currentCall) {
                currentCall.removeAllListeners();
                currentCall.cancel();
                currentCall = null;
            }

            const response = await prompts({
                type: 'text',
                name: 'input',
                message: chalk.blue('User: ')
            });

             // Check if input is undefined (Ctrl+C or other interruption)
            if (response.input === undefined) {
                 console.log(chalk.cyan('\nExiting chat session (input cancelled or invalid).'));
                 break;
            }
            
            const input = response.input.trim();
            
            if (!input) {
                continue;
            }

            try {
                console.log(chalk.green('Model: '));
                const userMessage: ProtoHistoryItem = { role: 'user', parts: [{ text: input }] };
                const request = { prompt: input, history: history };

                await new Promise<void>((resolve, reject) => {
                    currentCall = client.streamChat(request, metadata);
                    if (!currentCall) { reject(new Error('Failed to initiate gRPC stream call.')); return; }

                    let accumulatedResponse = '';
                    let receivedError = false;
                    let finishedCleanly = false;

                    currentCall.on('data', (chunk: any) => {
                        if (chunk.error) {
                            console.error(chalk.red(`\nServer Stream Error: ${chunk.error}`));
                            receivedError = true;
                        } else if (chunk.text_chunk) {
                            process.stdout.write(chunk.text_chunk);
                            accumulatedResponse += chunk.text_chunk;
                        }
                        if (chunk.is_final_chunk) {
                            console.log(); // Final newline
                            if (chunk.finish_reason && chunk.finish_reason !== 'STOP') {
                                console.warn(chalk.yellow(`\nStream finished with reason: ${chunk.finish_reason}`));
                            }
                        }
                    });

                    currentCall.on('end', () => {
                        finishedCleanly = true;
                        if (!receivedError && accumulatedResponse) {
                             history.push(userMessage);
                             history.push({ role: 'model', parts: [{ text: accumulatedResponse }] });
                        } else {
                            history.push(userMessage);
                        }
                        currentCall = null;
                        resolve();
                    });

                    currentCall.on('error', (err: grpc.ServiceError) => {
                        if (err.code !== grpc.status.CANCELLED) {
                            console.error(chalk.red('\ngRPC Stream Error:'), err.details || err.message);
                            history.push(userMessage);
                        }
                        receivedError = true; 
                        currentCall = null;
                        if (err.code !== grpc.status.CANCELLED) { reject(err); } else { resolve(); }
                    });

                    currentCall.on('status', (status: grpc.StatusObject) => {
                        if (status.code !== grpc.status.OK && status.code !== grpc.status.CANCELLED) {
                            console.error(chalk.yellow(`\ngRPC Stream Status Error: ${status.details}`));
                        }
                    });
                }); // End promise

            } catch (error: unknown) {
                if (error instanceof Error && error.message !== 'Failed to initiate gRPC stream call.') {
                     console.error(chalk.red('Error processing stream call:'), error.message);
                } else if (!(error instanceof Error)) {
                    console.error(chalk.red('Unknown error processing stream call'), error);
                }
            }
        } // End while loop
    } catch (error) {
        // Catch potential errors from prompts itself if not handled by onCancel
        console.error(chalk.red('An unexpected error occurred:'), error);
    }
     // No rl.close() needed
     // Ensure final cancellation if main loop errors
     if (currentCall) {
            currentCall.removeAllListeners();
            currentCall.cancel();
     }
}