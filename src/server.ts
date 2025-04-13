import express, { Request, Response, NextFunction } from 'express';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// --- Configuration (from Environment Variables) ---
// These names MUST match the environment variables defined in terraform/main.tf
const PORT = process.env.PORT || 8080;
const EXPECTED_API_KEY = process.env.EXPECTED_API_KEY; // Re-enable API Key from environment
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_REGION = process.env.GCP_REGION;
const VERTEX_AI_ENDPOINT = process.env.VERTEX_AI_ENDPOINT; // e.g., "europe-west1-aiplatform.googleapis.com"
const VERTEX_AI_MODEL_ID = process.env.VERTEX_AI_MODEL_ID; // e.g., "gemini-1.5-pro-002"

// Validate that all required environment variables are set
if (!GCP_PROJECT_ID || !GCP_REGION || !VERTEX_AI_ENDPOINT || !VERTEX_AI_MODEL_ID) {
    console.error('FATAL ERROR: Missing one or more required environment variables!');
    console.error('Check:', {
        GCP_PROJECT_ID: !!GCP_PROJECT_ID,
        GCP_REGION: !!GCP_REGION,
        VERTEX_AI_ENDPOINT: !!VERTEX_AI_ENDPOINT,
        VERTEX_AI_MODEL_ID: !!VERTEX_AI_MODEL_ID,
    });
    process.exit(1); // Exit if configuration is incomplete
}

// --- API Key Authentication Middleware (Re-enabled) ---

const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'];

  // Check if EXPECTED_API_KEY is set in the environment first
  if (!EXPECTED_API_KEY) {
    console.error('FATAL SERVER ERROR: EXPECTED_API_KEY environment variable is not set!');
    return res.status(500).send({ error: 'Server configuration error' });
  }

  // Now check if the provided key matches
  if (!apiKey || apiKey !== EXPECTED_API_KEY) {
    console.warn(`Unauthorized access attempt: Missing or incorrect API key. Path: ${req.path}`);
    return res.status(401).send({ error: 'Unauthorized: Invalid or missing API Key' });
  }

  next();
};

// Apply the API Key middleware to all subsequent routes
app.use(apiKeyMiddleware);

// --- Vertex AI Client Initialization (Updated) ---
const vertexAI = new VertexAI({
    project: GCP_PROJECT_ID,
    location: GCP_REGION,
    // apiEndpoint: VERTEX_AI_ENDPOINT // Optional: Usually inferred from location
});

// Get a reference to the generative model
const generativeModel = vertexAI.getGenerativeModel({
    model: VERTEX_AI_MODEL_ID, // e.g., "gemini-1.5-pro-002"
    // Optional: Add safety settings and generation config here or in the request
     safetySettings: [
         { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
         { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
         { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
         { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
     ],
     generationConfig: {
         temperature: 0.7,
         maxOutputTokens: 1024,
       // topP: 1.0,
       // topK: 40
     },
});

// --- Type Definitions (Optional but Recommended) ---
// Define types for the expected request body and Vertex AI history items
interface ChatboxRequest {
    prompt: string;
    history?: VertexAIChatHistoryItem[]; // Expecting history in Vertex AI format directly
    // Add other fields if Chatbox sends them (e.g., generationConfig)
}

interface VertexAIChatHistoryItem {
    role: 'user' | 'model'; // Gemini uses 'model' for assistant role
    parts: { text: string }[];
}

interface VertexAICandidate {
    content?: { 
        parts: { text: string }[]; 
        role: string; 
    };
    // Include other fields like finishReason, safetyRatings if needed
    finishReason?: string;
    safetyRatings?: any[]; 
}

interface ChatboxResponse {
    candidates: VertexAICandidate[];
    // Add other top-level fields if Chatbox expects them
}

// --- Proxy Route (/v1/chat) (Updated) ---
app.post('/v1/chat', async (req: Request<{}, ChatboxResponse, ChatboxRequest>, res: Response<ChatboxResponse>) => {
    console.log(`Received request for /v1/chat from ${req.ip}`);
    try {
        const userPrompt = req.body.prompt;
        const chatHistory = req.body.history || []; // Expecting history in Vertex AI format

        if (!userPrompt) {
            console.warn('Bad Request: Missing "prompt" in request body.');
            return res.status(400).send({ candidates: [] });
        }

        // Construct the 'contents' array for the generateContent method
        const contents: VertexAIChatHistoryItem[] = [
            ...chatHistory,
            { role: 'user', parts: [{ text: userPrompt }] },
        ];

        // Prepare the request for generateContent
        const generateContentRequest = {
            contents: contents,
            // generationConfig and safetySettings can be passed here too,
            // overriding the ones set during model initialization if needed.
        };

        console.log('Sending request to Gemini model:', JSON.stringify(generateContentRequest.contents, null, 2));

        // Call the correct method: generateContent
        const result = await generativeModel.generateContent(generateContentRequest);
        const generationResponse = result.response; // Access the main response part

        console.log('Received response from Gemini model');

        // --- Response Transformation (Updated for generateContent response) ---
        let chatboxResponse: ChatboxResponse = { candidates: [] };

        if (generationResponse && generationResponse.candidates && generationResponse.candidates.length > 0) {
             // Map candidates using older JS syntax for debugging build
            const mappedCandidates: VertexAICandidate[] = [];
            generationResponse.candidates.forEach(candidate => {
                let mappedParts: { text: string }[] = [];
                let mappedContent: { role: string; parts: { text: string }[] } | undefined = undefined;

                // Check if content and content.parts exist
                if (candidate.content && candidate.content.parts) {
                    candidate.content.parts.forEach(part => {
                        // Check if part.text is a string
                        if (typeof part.text === 'string') {
                            mappedParts.push({ text: part.text });
                        }
                    });
                    // Only create mappedContent if parts were found
                    if (mappedParts.length > 0) {
                         mappedContent = { role: candidate.content.role, parts: mappedParts };
                    }
                }
                
                // Only add candidate to results if we successfully mapped content with text parts
                if (mappedContent) {
                     mappedCandidates.push({
                         content: mappedContent,
                         finishReason: candidate.finishReason,
                         safetyRatings: candidate.safetyRatings,
                     });
                }
            });
            chatboxResponse.candidates = mappedCandidates;

        } else {
            console.warn('Gemini response did not contain valid candidates.');
            // Handle cases where the response might be blocked or empty
            if (generationResponse?.promptFeedback?.blockReason) {
                 console.warn(`Response blocked due to: ${generationResponse.promptFeedback.blockReason}`);
                 chatboxResponse = { candidates: [{ content: { role: 'model', parts: [{text: `Response blocked: ${generationResponse.promptFeedback.blockReason}`}]}}]};
            } else {
                 chatboxResponse = { candidates: [{ content: { role: 'model', parts: [{text: 'Sorry, I could not generate a response.'}]}}]};
            }
        }

        console.log('Sending transformed response to client:', JSON.stringify(chatboxResponse, null, 2));
        res.status(200).json(chatboxResponse);

    } catch (error: any) {
        console.error('Error processing /v1/chat request:', error);
        res.status(500).send({ candidates: [], error: 'Internal Server Error' } as any);
    }
});

// --- Health Check Route ---
app.get('/_health', (req: Request, res: Response) => {
    res.status(200).send('OK');
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log('Vertex AI Proxy Configuration:', {
        GCP_PROJECT_ID,
        GCP_REGION,
        VERTEX_AI_ENDPOINT,
        VERTEX_AI_MODEL_ID,
    });
}); 