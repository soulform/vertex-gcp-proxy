import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'node:readline';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

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

// Refactored to use gRPC streaming call
async function startInteractiveStreamingChat(client: any, metadata: grpc.Metadata): Promise<void> {
  console.log(chalk.cyan('Starting interactive gRPC streaming chat session. Type "exit" to quit.'));

  const history: ProtoHistoryItem[] = []; // History in proto format
  let currentCall: grpc.ClientReadableStream<any> | null = null;

  const promptUser = () => {
     // Cancel previous call if it exists and is still running
     if (currentCall) {
        currentCall.cancel();
        currentCall = null;
     }

    rl.question(chalk.blue('User: '), (input) => {
      if (input.toLowerCase() === 'exit') {
        console.log(chalk.cyan('Exiting chat session.'));
        if (currentCall) currentCall.cancel();
        rl.close();
        return;
      }

      try {
        console.log(chalk.green('Model: ')); // Print header before streaming

        const userMessage: ProtoHistoryItem = { role: 'user', parts: [{ text: input }] };

        const request = {
          prompt: input,
          history: history, // Send previous history
        };

        // Assign to outer variable for cancellation tracking
        currentCall = client.streamChat(request, metadata);

        // Explicitly check if the call object was created successfully
        if (!currentCall) {
          console.error(chalk.red('Failed to initiate gRPC stream call.'));
          // Add user message to history even if call failed?
          history.push(userMessage);
          currentCall = null; // Ensure state is clean
          promptUser(); // Ask for next input
          return; // Exit current try block
        }
        
        // Use a local non-null variable for attaching listeners immediately
        const call = currentCall; 
        
        let accumulatedResponse = '';
        let receivedError = false;

        // Attach listeners using the local 'call' variable
        call.on('data', (chunk: any) => {
             if (chunk.error) {
                console.error(chalk.red(`\nServer Stream Error: ${chunk.error}`));
                receivedError = true;
                // Continue listening or cancel?
            } else if (chunk.text_chunk) {
                process.stdout.write(chunk.text_chunk);
                accumulatedResponse += chunk.text_chunk;
            }
            if (chunk.is_final_chunk) {
                 console.log(); // Final newline
                 if (chunk.finish_reason && chunk.finish_reason !== 'STOP') {
                     console.warn(chalk.yellow(`\nStream finished with reason: ${chunk.finish_reason}`));
                 }
                 // History update happens on 'end' or 'status' normally
            }
        });

        call.on('end', () => {
            console.log(); // Ensure newline
            if (!receivedError && accumulatedResponse) {
                 // Add user message AND successful model response to history
                 history.push(userMessage);
                 history.push({ role: 'model', parts: [{ text: accumulatedResponse }] });
            } else if (!receivedError && !accumulatedResponse) {
                 // Model produced no output but no error - add user msg?
                 history.push(userMessage);
            } else {
                 // Error occurred, only add user message?
                 history.push(userMessage);
            }
            currentCall = null; // Reset outer variable
            promptUser(); // Continue conversation
        });

        call.on('error', (err: grpc.ServiceError) => {
            console.error(chalk.red('\ngRPC Stream Error:'), err.details || err.message);
            receivedError = true; // Mark error occurred
             // Add user message to history even on error?
            history.push(userMessage);
            // Still cancel using the outer variable reference if needed, though call might be implicitly ended
            if (currentCall) currentCall.cancel(); 
            currentCall = null; // Reset outer variable
            promptUser(); // Continue conversation even on error
        });

         call.on('status', (status: grpc.StatusObject) => {
            if (status.code !== grpc.status.OK) {
                console.error(chalk.yellow(`\ngRPC Stream Status Error: ${status.details}`));
                // If end hasn't been called yet, handle history here?
                // This might overlap with 'error' handler.
            }
        });

      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error(chalk.red('Error setting up stream call:'), error.message);
        } else {
          console.error(chalk.red('Unknown error setting up stream call'), error);
        }
        if (currentCall) currentCall.cancel();
        currentCall = null;
        promptUser(); // Continue loop even if setup fails
      }
    });
  };

  promptUser(); // Start the interactive loop
}