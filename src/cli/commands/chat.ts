import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'node:readline';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

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

async function startInteractiveChat(client: any, metadata: grpc.Metadata): Promise<void> {
  console.log(chalk.cyan('Starting interactive gRPC chat session. Type "exit" to quit.'));

  const history: ProtoHistoryItem[] = []; // History in proto format

  const promptUser = () => {
    rl.question(chalk.blue('User: '), async (input) => {
      if (input.toLowerCase() === 'exit') {
        console.log(chalk.cyan('Exiting chat session.'));
        rl.close();
        return;
      }

      try {
        const userMessage: ProtoHistoryItem = { role: 'user', parts: [{ text: input }] };

        const request = {
          prompt: input,
          history: history, // Send previous history
        };

         await new Promise<void>((resolve, reject) => {
            client.chat(request, metadata, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    console.error(chalk.red('gRPC Error:'), err.details || err.message);
                    // Optionally add user message to history despite error
                    history.push(userMessage);
                    reject(err);
                } else if (response.error) {
                     console.error(chalk.red('Proxy Server Error:'), response.error);
                     // Optionally add user message to history despite error
                     history.push(userMessage);
                     resolve();
                } else {
                    const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (responseText) {
                        console.log(chalk.green('Model: ') + responseText);
                        // Add user message AND model response to history for next turn
                        history.push(userMessage);
                        history.push({ role: 'model', parts: [{ text: responseText }] });
                    } else {
                        console.warn(chalk.yellow('Model response format unexpected or empty.'), JSON.stringify(response, null, 2));
                        // Optionally add user message to history
                        history.push(userMessage);
                    }
                    resolve();
                }
            });
        });

      } catch (error) {
         // Error is logged within the callback
         console.error(chalk.red('Failed during interactive gRPC request.'));
      }

      promptUser(); // Continue the conversation
    });
  };

  promptUser();
}
