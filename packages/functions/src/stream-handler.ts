/**
 * AWS Lambda Function URL handler for SSE streaming responses.
 * Used for /ask/stream and /chat/stream endpoints that require streaming.
 *
 * Lambda Function URLs support streaming response mode, unlike API Gateway.
 */

/**
 * NOTE: This file is ONLY for AWS Lambda cloud deployment.
 * For local development, use the regular API server in packages/api.
 *
 * Types are imported dynamically to avoid requiring AWS SDK locally.
 */

// For streaming responses, we need to use the awslambda.streamifyResponse
declare const awslambda: {
    streamifyResponse: (
        handler: (
            event: any,
            responseStream: NodeJS.WritableStream,
            context: any
        ) => Promise<void>
    ) => (event: any, context: any) => Promise<void>;
    HttpResponseStream: {
        from: (stream: NodeJS.WritableStream, metadata: any) => NodeJS.WritableStream;
    };
};

// Lazy initialization
let fraktag: any = null;

async function initFraktag() {
    if (!fraktag) {
        process.env.FRAKTAG_DEPLOY_MODE = 'cloud';

        // Fetch OpenAI key from Secrets Manager
        if (process.env.OPENAI_SECRET_ARN && !process.env.OPENAI_API_KEY) {
            try {
                // @ts-ignore - AWS SDK only available in Lambda environment
                const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
                const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'eu-central-1' });
                const response = await client.send(new GetSecretValueCommand({
                    SecretId: process.env.OPENAI_SECRET_ARN,
                }));
                if (response.SecretString) {
                    const secret = JSON.parse(response.SecretString);
                    process.env.OPENAI_API_KEY = secret.OPENAI_API_KEY || secret.apiKey || response.SecretString;
                }
            } catch (e) {
                console.error('Failed to fetch secrets:', e);
            }
        }

        // Use factory method - Fraktag has a private constructor
        const { Fraktag } = await import('@fraktag/engine');

        // For Lambda, we need a config - use environment or a minimal config
        const config: any = {
            instanceId: process.env.FRAKTAG_INSTANCE_ID || 'lambda-instance',
            storagePath: process.env.FRAKTAG_STORAGE_PATH || '/tmp/fraktag',
            trees: [],
            llm: {
                adapter: 'openai',
                model: process.env.FRAKTAG_MODEL || 'gpt-4o-mini',
                apiKey: process.env.OPENAI_API_KEY,
            },
            embedding: {
                adapter: 'openai',
                model: 'text-embedding-3-small',
                apiKey: process.env.OPENAI_API_KEY,
            },
            ingestion: {
                splitThreshold: 2000,
                maxDepth: 3,
                chunkOverlap: 100,
            },
        };

        fraktag = await Fraktag.fromConfig(config);
    }
    return fraktag;
}

/**
 * Parse JWT from Authorization header (basic extraction, validation done elsewhere).
 */
function extractUserId(authHeader?: string): string {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return 'anonymous';
    }

    try {
        const token = authHeader.substring(7);
        const parts = token.split('.');
        if (parts.length !== 3) return 'anonymous';

        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        return payload.sub || 'anonymous';
    } catch {
        return 'anonymous';
    }
}

/**
 * Streaming handler for chat/ask endpoints.
 */
async function streamHandler(
    event: any,
    responseStream: NodeJS.WritableStream,
    context: any
): Promise<void> {
    if (context) context.callbackWaitsForEmptyEventLoop = false;

    // Set SSE headers
    const httpStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        },
    });

    try {
        const engine = await initFraktag();
        const userId = extractUserId(event.headers?.authorization);
        const body = event.body ? JSON.parse(event.body) : {};

        const { query, treeId, kbId } = body;

        if (!query) {
            httpStream.write(`data: ${JSON.stringify({ error: 'Query required' })}\n\n`);
            httpStream.end();
            return;
        }

        // Use the engine's streaming askStream method
        await engine.askStream(query, treeId || 'notes', (event: any) => {
            switch (event.type) {
                case 'source':
                    httpStream.write(`data: ${JSON.stringify({ type: 'source', ...event.data })}\n\n`);
                    break;
                case 'answer_chunk':
                    httpStream.write(`data: ${JSON.stringify({ type: 'chunk', content: event.data })}\n\n`);
                    break;
                case 'done':
                    httpStream.write(`data: ${JSON.stringify({ type: 'done', ...event.data })}\n\n`);
                    break;
                case 'error':
                    httpStream.write(`data: ${JSON.stringify({ type: 'error', error: event.data })}\n\n`);
                    break;
            }
        });

        httpStream.end();

    } catch (error: any) {
        console.error('Stream handler error:', error);
        httpStream.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        httpStream.end();
    }
}

// Export the streamified handler
export const handler = typeof awslambda !== 'undefined'
    ? awslambda.streamifyResponse(streamHandler)
    : async (event: any, context: any): Promise<any> => {
        // Fallback for local testing
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Streaming not supported in this environment' }),
        };
    };
