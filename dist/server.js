"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const vertexai_1 = require("@google-cloud/vertexai");
const app = (0, express_1.default)();
app.use(express_1.default.json()); // Middleware to parse JSON bodies
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
const apiKeyMiddleware = (req, res, next) => {
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
const vertexAI = new vertexai_1.VertexAI({
    project: GCP_PROJECT_ID,
    location: GCP_REGION,
    // apiEndpoint: VERTEX_AI_ENDPOINT // Optional: Usually inferred from location
});
// Get a reference to the generative model
const generativeModel = vertexAI.getGenerativeModel({
    model: VERTEX_AI_MODEL_ID, // e.g., "gemini-1.5-pro-002"
    // Optional: Add safety settings and generation config here or in the request
    safetySettings: [
        { category: vertexai_1.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: vertexai_1.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: vertexai_1.HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: vertexai_1.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: vertexai_1.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: vertexai_1.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: vertexai_1.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: vertexai_1.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ],
    generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        // topP: 1.0,
        // topK: 40
    },
});
// --- Proxy Route (/v1/chat) (Updated) ---
app.post('/v1/chat', async (req, res) => {
    console.log(`Received request for /v1/chat from ${req.ip}`);
    try {
        const userPrompt = req.body.prompt;
        const chatHistory = req.body.history || []; // Expecting history in Vertex AI format
        if (!userPrompt) {
            console.warn('Bad Request: Missing "prompt" in request body.');
            return res.status(400).send({ candidates: [] });
        }
        // Construct the 'contents' array for the generateContent method
        const contents = [
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
        let clientResponse = { candidates: [] };
        if (generationResponse && generationResponse.candidates && generationResponse.candidates.length > 0) {
            // Map candidates using older JS syntax for debugging build
            const mappedCandidates = [];
            generationResponse.candidates.forEach(candidate => {
                let mappedParts = [];
                let mappedContent = undefined;
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
            clientResponse.candidates = mappedCandidates;
        }
        else {
            console.warn('Gemini response did not contain valid candidates.');
            // Handle cases where the response might be blocked or empty
            if (generationResponse?.promptFeedback?.blockReason) {
                console.warn(`Response blocked due to: ${generationResponse.promptFeedback.blockReason}`);
                clientResponse = { candidates: [{ content: { role: 'model', parts: [{ text: `Response blocked: ${generationResponse.promptFeedback.blockReason}` }] } }] };
            }
            else {
                clientResponse = { candidates: [{ content: { role: 'model', parts: [{ text: 'Sorry, I could not generate a response.' }] } }] };
            }
        }
        console.log('Sending transformed response to client:', JSON.stringify(clientResponse, null, 2));
        res.status(200).json(clientResponse);
    }
    catch (error) {
        console.error('Error processing /v1/chat request:', error);
        res.status(500).send({ candidates: [], error: 'Internal Server Error' });
    }
});
// --- Streaming Proxy Route (/v1/chat/stream) ---
app.post('/v1/chat/stream', async (req, res) => {
    console.log(`Received streaming request for /v1/chat/stream from ${req.ip}`);
    try {
        const userPrompt = req.body.prompt;
        const chatHistory = req.body.history || []; // Expecting history in Vertex AI format
        if (!userPrompt) {
            console.warn('Bad Request: Missing "prompt" in request body.');
            return res.status(400).send({ error: 'Missing prompt in request body' });
        }
        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        // Construct the 'contents' array for streaming
        const contents = [
            ...chatHistory,
            { role: 'user', parts: [{ text: userPrompt }] },
        ];
        // Prepare the request for generateContentStream
        const generateContentRequest = {
            contents: contents,
            // Same config can be passed as non-streaming endpoint
        };
        console.log('Sending streaming request to Gemini model');
        // Use the streaming method
        const streamingResult = await generativeModel.generateContentStream(generateContentRequest);
        // Process the stream
        try {
            // Track the full response for debugging
            let fullResponse = '';
            // Handle each chunk in the stream
            for await (const chunk of streamingResult.stream) {
                if (chunk.candidates && chunk.candidates.length > 0) {
                    // Process each candidate in the chunk
                    chunk.candidates.forEach(candidate => {
                        if (candidate.content && candidate.content.parts) {
                            candidate.content.parts.forEach(part => {
                                if (typeof part.text === 'string') {
                                    fullResponse += part.text; // Track full response
                                    // Create a properly formatted event for SSE
                                    const chunkData = {
                                        text: part.text,
                                        role: candidate.content.role || 'model',
                                        finishReason: candidate.finishReason || null
                                    };
                                    res.write(`data: ${JSON.stringify(chunkData)}\n\n`);
                                }
                            });
                        }
                    });
                }
            }
            // Handle the aggregated response if needed
            const aggregatedResponse = await streamingResult.response;
            // Send an end event with finishReason if available
            let finishReason = 'STOP';
            if (aggregatedResponse.candidates && aggregatedResponse.candidates.length > 0) {
                finishReason = aggregatedResponse.candidates[0].finishReason || 'STOP';
            }
            // Send the [DONE] event
            res.write(`data: ${JSON.stringify({ text: "[DONE]", finishReason })}\n\n`);
            console.log('Streaming response completed successfully');
            res.end();
        }
        catch (streamError) {
            console.error('Stream processing error:', streamError);
            // Try to send an error event if the connection is still open
            try {
                res.write(`data: ${JSON.stringify({ error: 'Stream processing error' })}\n\n`);
                res.end();
            }
            catch (finalError) {
                console.error('Failed to send error event:', finalError);
            }
        }
    }
    catch (error) {
        console.error('Error processing streaming request:', error);
        // Try to send an error response if headers haven't been sent
        if (!res.headersSent) {
            res.status(500).send({ error: 'Internal Server Error' });
        }
        else {
            // Try to send an error event
            try {
                res.write(`data: ${JSON.stringify({ error: 'Internal Server Error' })}\n\n`);
                res.end();
            }
            catch (finalError) {
                console.error('Failed to send error event:', finalError);
            }
        }
    }
});
// --- Health Check Route ---
app.get('/_health', (req, res) => {
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
//# sourceMappingURL=server.js.map