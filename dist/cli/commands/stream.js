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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamChatCommand = streamChatCommand;
const chalk_1 = __importDefault(require("chalk"));
const readline = __importStar(require("readline"));
const eventsource_1 = require("eventsource");
// We'll use the built-in MessageEvent interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
function streamChatCommand(program) {
    program
        .command('stream')
        .description('Chat with Vertex AI model using streaming responses')
        .option('-i, --interactive', 'Start an interactive streaming chat session')
        .option('-p, --prompt <prompt>', 'Single prompt to send with streaming response')
        .action(async (options) => {
        const API_URL = process.env.API_URL || 'http://localhost:8080';
        const API_KEY = process.env.API_KEY || '';
        if (!API_KEY) {
            console.error(chalk_1.default.red('Error: API_KEY environment variable is required'));
            process.exit(1);
        }
        if (options.interactive) {
            await startInteractiveStreamingChat(API_URL, API_KEY);
        }
        else if (options.prompt) {
            await sendStreamingPrompt(options.prompt, API_URL, API_KEY);
        }
        else {
            console.log(chalk_1.default.yellow('Please provide a prompt or use interactive mode.'));
            program.help();
        }
    });
}
async function sendStreamingPrompt(prompt, apiUrl, apiKey) {
    try {
        console.log(chalk_1.default.blue('User: ') + prompt);
        console.log(chalk_1.default.green('Model: '));
        // Handle the streaming response using EventSource directly
        return new Promise((resolve, reject) => {
            // Create EventSource instance for SSE with custom fetch for headers
            // We're using a POST request with EventSource (which would normally use GET)
            const es = new eventsource_1.EventSource(`${apiUrl}/v1/chat/stream`, {
                fetch: (url, init) => fetch(url, {
                    ...init,
                    method: 'POST',
                    headers: {
                        ...init?.headers,
                        'X-API-Key': apiKey,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ prompt }),
                })
            });
            es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.text === "[DONE]") {
                        es.close();
                        console.log('\n'); // Add a newline after completion
                        resolve();
                        return;
                    }
                    if (data.error) {
                        console.error(chalk_1.default.red('Error:'), data.error);
                        es.close();
                        reject(new Error(data.error));
                        return;
                    }
                    // Print the chunk of text without a newline to create a streaming effect
                    process.stdout.write(data.text);
                }
                catch (error) {
                    if (error instanceof Error) {
                        console.error(chalk_1.default.red('Error parsing event:'), error.message);
                    }
                    else {
                        console.error(chalk_1.default.red('Unknown error parsing event'));
                    }
                }
            };
            es.onerror = (error) => {
                console.error(chalk_1.default.red('EventSource error:'), error);
                es.close();
                reject(new Error('EventSource error'));
            };
        });
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(chalk_1.default.red('Error:'), error.message);
        }
        else {
            console.error(chalk_1.default.red('Unknown error occurred'));
        }
    }
}
async function startInteractiveStreamingChat(apiUrl, apiKey) {
    console.log(chalk_1.default.cyan('Starting interactive streaming chat session. Type "exit" to quit.'));
    const history = [];
    const promptUser = () => {
        rl.question(chalk_1.default.blue('User: '), async (input) => {
            if (input.toLowerCase() === 'exit') {
                console.log(chalk_1.default.cyan('Exiting chat session.'));
                rl.close();
                return;
            }
            try {
                // Add user message to history
                history.push({
                    role: 'user',
                    parts: [{ text: input }]
                });
                console.log(chalk_1.default.green('Model: '));
                // Create EventSource instance for SSE with custom fetch for headers
                // We're using a POST request with EventSource (which would normally use GET)
                const es = new eventsource_1.EventSource(`${apiUrl}/v1/chat/stream`, {
                    fetch: (url, init) => fetch(url, {
                        ...init,
                        method: 'POST',
                        headers: {
                            ...init?.headers,
                            'X-API-Key': apiKey,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            prompt: input,
                            history: history.slice(0, -1) // Exclude the last message which we just added 
                        }),
                    })
                });
                let fullResponse = '';
                es.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.text === "[DONE]") {
                            es.close();
                            console.log('\n'); // Add a newline after completion
                            // Add model response to history
                            history.push({
                                role: 'model',
                                parts: [{ text: fullResponse }]
                            });
                            promptUser(); // Continue the conversation
                            return;
                        }
                        if (data.error) {
                            console.error(chalk_1.default.red('Error:'), data.error);
                            es.close();
                            promptUser(); // Continue despite error
                            return;
                        }
                        // Accumulate the full response
                        fullResponse += data.text;
                        // Print the chunk without a newline
                        process.stdout.write(data.text);
                    }
                    catch (error) {
                        if (error instanceof Error) {
                            console.error(chalk_1.default.red('Error parsing event:'), error.message);
                        }
                        else {
                            console.error(chalk_1.default.red('Unknown error parsing event'));
                        }
                    }
                };
                es.onerror = (error) => {
                    console.error(chalk_1.default.red('EventSource error:'), error);
                    es.close();
                    promptUser(); // Continue despite error
                };
                return; // Don't call promptUser() here, will be called when stream ends
            }
            catch (error) {
                if (error instanceof Error) {
                    console.error(chalk_1.default.red('Error:'), error.message);
                }
                else {
                    console.error(chalk_1.default.red('Unknown error occurred'));
                }
                promptUser(); // Continue despite error
            }
        });
    };
    promptUser();
}
//# sourceMappingURL=stream.js.map