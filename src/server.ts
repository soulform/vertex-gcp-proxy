import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { 
    VertexAI, 
    HarmCategory, 
    HarmBlockThreshold, 
    GenerateContentRequest, 
    Content, 
    Part, 
    GenerateContentResponse, 
    GenerateContentResult 
} from '@google-cloud/vertexai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Configuration (from Environment Variables) ---
const PORT = process.env.PORT || 8080;
const EXPECTED_API_KEY = process.env.EXPECTED_API_KEY; // Fetch securely in production!
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_REGION = process.env.GCP_REGION;
const VERTEX_AI_MODEL_ID = process.env.VERTEX_AI_MODEL_ID; // e.g., "gemini-1.5-pro-002"

// Get current directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTO_PATH = path.join(__dirname, 'proto/vertex_proxy.proto');

// Validate that all required environment variables are set
if (!GCP_PROJECT_ID || !GCP_REGION || !VERTEX_AI_MODEL_ID || !EXPECTED_API_KEY) {
    console.error('FATAL ERROR: Missing one or more required environment variables!');
    console.error('Check:', {
        EXPECTED_API_KEY: !!EXPECTED_API_KEY,
        GCP_PROJECT_ID: !!GCP_PROJECT_ID,
        GCP_REGION: !!GCP_REGION,
        VERTEX_AI_MODEL_ID: !!VERTEX_AI_MODEL_ID,
    });
    process.exit(1); // Exit if configuration is incomplete
}

// --- Load Protobuf Definition ---
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const vertexProxyProto = grpc.loadPackageDefinition(packageDefinition).vertexproxy as any; // Type assertion needed

// --- Vertex AI Client Initialization ---
const vertexAI = new VertexAI({
    project: GCP_PROJECT_ID,
    location: GCP_REGION,
});
const generativeModel = vertexAI.getGenerativeModel({
    model: VERTEX_AI_MODEL_ID,
    safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ],
    generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
    },
});

// --- Helper: API Key Authentication Interceptor/Check ---
const checkApiKey = (call: grpc.ServerUnaryCall<any, any> | grpc.ServerWritableStream<any, any>): boolean => {
    const metadata = call.metadata;
    const apiKey = metadata.get('x-api-key'); // Metadata keys are lowercased
    if (!apiKey || apiKey.length === 0 || apiKey[0] !== EXPECTED_API_KEY) {
        console.warn(`Unauthorized access attempt: Missing or incorrect API key.`);
        return false;
    }
    return true;
};

// --- Helper: Map Proto History to Vertex AI Format ---
const mapProtoHistoryToVertex = (protoHistory: any[]): Content[] => {
    return protoHistory.map((item: any) => ({
        role: item.role,
        parts: item.parts.map((part: any) => ({ text: part.text })) as Part[],
    }));
};

// --- gRPC Service Implementation ---

// Handles the unary Chat RPC
const chat = async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    console.log('Received Chat request');
    if (!checkApiKey(call)) {
        return callback({ code: grpc.status.UNAUTHENTICATED, details: 'Invalid or missing API Key' });
    }

    try {
        const userPrompt = call.request.prompt;
        const protoHistory = call.request.history || [];

        if (!userPrompt) {
            console.warn('Bad Request: Missing "prompt" in request body.');
            return callback({ code: grpc.status.INVALID_ARGUMENT, details: 'Missing prompt' });
        }

        const vertexHistory = mapProtoHistoryToVertex(protoHistory);
        const contents: Content[] = [
            ...vertexHistory,
            { role: 'user', parts: [{ text: userPrompt }] },
        ];

        const generateContentRequest: GenerateContentRequest = { contents };
        console.log('Sending request to Gemini model:', JSON.stringify(contents, null, 2));

        const result: GenerateContentResult = await generativeModel.generateContent(generateContentRequest);
        const generationResponse: GenerateContentResponse = result.response;
        console.log('Received response from Gemini model');

        const responsePayload: any = { candidates: [], error: null };

        if (generationResponse && generationResponse.candidates && generationResponse.candidates.length > 0) {
            responsePayload.candidates = generationResponse.candidates.map(candidate => ({
                content: {
                    role: candidate.content?.role ?? 'model',
                    parts: candidate.content?.parts?.map(part => ({ text: part.text ?? '' })) ?? []
                },
                finish_reason: candidate.finishReason ?? ''
                // safetyRatings: candidate.safetyRatings // Omit for simplicity unless needed
            }));
        } else {
            console.warn('Gemini response did not contain valid candidates.');
            let errorMessage = 'Sorry, I could not generate a response.';
            if (generationResponse?.promptFeedback?.blockReason) {
                 console.warn(`Response blocked due to: ${generationResponse.promptFeedback.blockReason}`);
                 errorMessage = `Response blocked: ${generationResponse.promptFeedback.blockReason}`;
            }
             // Still send a 200 OK but indicate error in the payload
             responsePayload.error = errorMessage;
        }

        console.log('Sending transformed response to client:', JSON.stringify(responsePayload, null, 2));
        callback(null, responsePayload);

    } catch (error: any) {
        console.error('Error processing Chat request:', error);
        callback({ code: grpc.status.INTERNAL, details: 'Internal Server Error' });
    }
};

// Handles the server-streaming StreamChat RPC
const streamChat = async (call: grpc.ServerWritableStream<any, any>) => {
    console.log('Received StreamChat request');
    if (!checkApiKey(call)) {
        call.emit('error', { code: grpc.status.UNAUTHENTICATED, details: 'Invalid or missing API Key' });
        call.end();
        return;
    }

    try {
        const userPrompt = call.request.prompt;
        const protoHistory = call.request.history || [];

        if (!userPrompt) {
            console.warn('Bad Request: Missing "prompt" in request body.');
            call.emit('error', { code: grpc.status.INVALID_ARGUMENT, details: 'Missing prompt' });
            call.end();
            return;
        }

        const vertexHistory = mapProtoHistoryToVertex(protoHistory);
        const contents: Content[] = [
            ...vertexHistory,
            { role: 'user', parts: [{ text: userPrompt }] },
        ];

        const generateContentRequest: GenerateContentRequest = { contents };
        console.log('Sending streaming request to Gemini model');

        const streamingResult = await generativeModel.generateContentStream(generateContentRequest);

        // Process the stream
        let responseSent = false;
        for await (const item of streamingResult.stream) {
            if (item?.candidates && item.candidates.length > 0) {
                item.candidates.forEach(candidate => {
                    if (candidate?.content?.parts && candidate.content.parts.length > 0) {
                        candidate.content.parts.forEach(part => {
                            if (part.text) {
                                const chunkResponse: any = {
                                    text_chunk: part.text,
                                    finish_reason: candidate.finishReason ?? null,
                                    error: null,
                                    is_final_chunk: false
                                };
                                console.log(`Writing stream chunk: ${part.text.substring(0, 50)}...`);
                                call.write(chunkResponse);
                                responseSent = true;
                            }
                        });
                    }
                });
            }
        }

        // Handle aggregated response to get final finish reason
        const aggregatedResponse = await streamingResult.response;
        let finalFinishReason = aggregatedResponse?.candidates?.[0]?.finishReason ?? 'STOP';

         // Send a final message indicating completion
        const finalChunk: any = {
             text_chunk: '',
             finish_reason: finalFinishReason,
             error: null,
             is_final_chunk: true
         };
        console.log('Writing final stream chunk');
        call.write(finalChunk);
        console.log('Streaming response completed successfully');
        call.end(); // End the stream

    } catch (error: any) {
        console.error('Error processing StreamChat request:', error);
        // Try to send an error message back to the client
        try {
             call.write({ text_chunk: '', error: 'Internal Server Error', is_final_chunk: true });
        } catch (writeError) {
            console.error('Failed to write error to stream:', writeError);
        }
        call.end();
    }
};


// --- Start gRPC Server ---
const server = new grpc.Server();
server.addService((vertexProxyProto.VertexProxy as any).service, { chat, streamChat });

server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
        console.error('Failed to bind server:', err);
        return;
    }
    console.log(`gRPC Server listening on port ${port}`);
    console.log('Vertex AI Proxy Configuration:', {
        GCP_PROJECT_ID,
        GCP_REGION,
        VERTEX_AI_MODEL_ID,
    });
    server.start();
}); 