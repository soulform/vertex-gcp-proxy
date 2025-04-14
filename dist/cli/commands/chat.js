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
exports.chatCommand = chatCommand;
const axios_1 = __importDefault(require("axios"));
const chalk_1 = __importDefault(require("chalk"));
const readline = __importStar(require("readline"));
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
function chatCommand(program) {
    program
        .command('chat')
        .description('Chat with Vertex AI model')
        .option('-i, --interactive', 'Start an interactive chat session')
        .option('-p, --prompt <prompt>', 'Single prompt to send')
        .action(async (options) => {
        const API_URL = process.env.API_URL || 'http://localhost:8080';
        const API_KEY = process.env.API_KEY || '';
        if (!API_KEY) {
            console.error(chalk_1.default.red('Error: API_KEY environment variable is required'));
            process.exit(1);
        }
        if (options.interactive) {
            await startInteractiveChat(API_URL, API_KEY);
        }
        else if (options.prompt) {
            await sendSinglePrompt(options.prompt, API_URL, API_KEY);
        }
        else {
            console.log(chalk_1.default.yellow('Please provide a prompt or use interactive mode.'));
            program.help();
        }
    });
}
async function sendSinglePrompt(prompt, apiUrl, apiKey) {
    try {
        console.log(chalk_1.default.blue('User: ') + prompt);
        const response = await axios_1.default.post(`${apiUrl}/v1/chat`, { prompt }, {
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
            },
        });
        if (response.data.candidates && response.data.candidates.length > 0) {
            const candidate = response.data.candidates[0];
            if (candidate.content && candidate.content.parts) {
                const text = candidate.content.parts.map((part) => part.text).join('');
                console.log(chalk_1.default.green('Model: ') + text);
            }
        }
        else {
            console.log(chalk_1.default.red('No response generated.'));
        }
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
async function startInteractiveChat(apiUrl, apiKey) {
    console.log(chalk_1.default.cyan('Starting interactive chat session. Type "exit" to quit.'));
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
                const response = await axios_1.default.post(`${apiUrl}/v1/chat`, {
                    prompt: input,
                    history: history.slice(0, -1) // Exclude the last message which we just added
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey,
                    },
                });
                if (response.data.candidates && response.data.candidates.length > 0) {
                    const candidate = response.data.candidates[0];
                    if (candidate.content && candidate.content.parts) {
                        const text = candidate.content.parts.map((part) => part.text).join('');
                        console.log(chalk_1.default.green('Model: ') + text);
                        // Add model response to history
                        history.push({
                            role: 'model',
                            parts: [{ text }]
                        });
                    }
                }
                else {
                    console.log(chalk_1.default.red('No response generated.'));
                }
            }
            catch (error) {
                if (error instanceof Error) {
                    console.error(chalk_1.default.red('Error:'), error.message);
                }
                else {
                    console.error(chalk_1.default.red('Unknown error occurred'));
                }
            }
            promptUser(); // Continue the conversation
        });
    };
    promptUser();
}
//# sourceMappingURL=chat.js.map