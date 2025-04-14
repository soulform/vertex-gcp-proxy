import { Command } from 'commander';
import chalk from 'chalk';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';
import { ClientReadableStream, type Client, type ServiceError } from '@grpc/grpc-js';

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
        await startInteractiveStreamingChat(client, GRPC_TARGET, API_KEY);
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
async function startInteractiveStreamingChat(
  client: any,
  target: string,
  apiKey: string,
) {
  console.log(chalk.blue('Starting interactive streaming chat...'));
  console.log(chalk.yellow('Type "exit" or press Ctrl+C to quit.'));

  const history: ProtoHistoryItem[] = [];
  let call: ClientReadableStream<any> | null = null;

  while (true) {
    const response = await prompts({
      type: 'text',
      name: 'input',
      message: chalk.green('You:'),
      validate: (input) => (input.trim().length > 0 ? true : 'Input cannot be empty.'),
    });

    if (response.input === undefined || response.input.toLowerCase() === 'exit') {
      console.log(chalk.yellow('Exiting chat...'));
      break;
    }

    const userInput = response.input;
    history.push({ role: 'user', parts: [{ text: userInput }] });

    const request = { prompt: userInput, history: history };
    const metadata = new grpc.Metadata();
    metadata.add('x-api-key', apiKey);

    let fullResponse = '';
    let streamClosed = false;

    try {
      call = client.streamChat(request, metadata) as ClientReadableStream<any>;

      process.stdout.write(chalk.cyan('Model: '));

      await new Promise<void>((resolve, reject) => {
        if (!call) return reject(new Error("Stream call not initiated"));

        call.on('data', (chunk: any) => {
          const text = chunk.text_chunk;
          if (text) {
            process.stdout.write(chalk.cyan(text));
            fullResponse += text;
          }
        });

        call.on('end', () => {
          process.stdout.write('\n');
          if (fullResponse) {
            history.push({ role: 'model', parts: [{ text: fullResponse }] });
          }
          streamClosed = true;
          resolve();
        });

        call.on('error', (err: ServiceError) => {
          process.stdout.write('\n');
          console.error(chalk.red(`\n[gRPC Stream Error] Code: ${err.code} - ${err.details}`));
          streamClosed = true;
          reject(err);
        });
      });
    } catch (error: any) {
      if (!streamClosed) {
         console.error(chalk.red(`[Error] Failed to process stream: ${error.message || error}`));
      }
    } finally {
      if (call) {
        call.removeAllListeners();
      }
    }
  }
}

async function handleStreamCommand(
  prompt: string | undefined,
  interactive: boolean,
  client: any,
  target: string,
  apiKey: string,
) {
  if (interactive) {
    await startInteractiveStreamingChat(client, target, apiKey);
  } else if (prompt) {
    const history: ProtoHistoryItem[] = [{ role: 'user', parts: [{ text: prompt }] }];
    const request = { prompt: prompt, history: history };
    const metadata = new grpc.Metadata();
    metadata.add('x-api-key', apiKey);
    let call: ClientReadableStream<any> | null = null;
    let streamClosed = false;

    try {
      console.log(chalk.green(`User: ${prompt}`));
      process.stdout.write(chalk.cyan('Model: '));

      call = client.streamChat(request, metadata) as ClientReadableStream<any>;

      await new Promise<void>((resolve, reject) => {
         if (!call) return reject(new Error("Stream call not initiated"));

        call.on('data', (chunk: any) => {
          const text = chunk.text_chunk;
          if (text) {
            process.stdout.write(chalk.cyan(text));
          }
        });

        call.on('end', () => {
          process.stdout.write('\n');
          streamClosed = true;
          resolve();
        });

        call.on('error', (err: ServiceError) => {
           process.stdout.write('\n');
          console.error(chalk.red(`\n[gRPC Stream Error] Code: ${err.code} - ${err.details}`));
          streamClosed = true;
          reject(err);
        });
      });
    } catch (error: any) {
      if (!streamClosed) {
         console.error(chalk.red(`[Error] Failed to process stream: ${error.message || error}`));
      }
    } finally {
      if (call) {
        call.removeAllListeners();
      }
    }
  } else {
    console.error(chalk.red('Error: Prompt is required for non-interactive mode.'));
    process.exit(1);
  }
}