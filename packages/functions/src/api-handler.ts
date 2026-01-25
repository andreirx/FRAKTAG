/**
 * AWS Lambda handler for API Gateway proxy integration.
 * Wraps the Express app for serverless deployment.
 *
 * NOTE: This file is ONLY for AWS Lambda cloud deployment.
 * For local development, use the regular API server in packages/api.
 */

// Lazy initialization to reduce cold start time
let serverlessApp: any = null;

async function getApp() {
    if (!serverlessApp) {
        // Set cloud mode environment
        process.env.FRAKTAG_DEPLOY_MODE = 'cloud';

        // Fetch secrets if needed
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

        // Import the Express app
        const { createApp } = await import('@fraktag/api');
        const express = await createApp();

        // Use serverless-http to wrap Express for Lambda
        const serverless = (await import('serverless-http')).default;
        serverlessApp = serverless(express, {
            request: (req: any, event: any) => {
                // Pass through API Gateway context
                req.apiGateway = { event };
            },
        });
    }
    return serverlessApp;
}

export async function handler(
    event: any,
    context: any
): Promise<any> {
    // Prevent Lambda from waiting for event loop
    if (context) context.callbackWaitsForEmptyEventLoop = false;

    try {
        const app = await getApp();
        return await app(event, context);
    } catch (error: any) {
        console.error('Lambda handler error:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal server error', message: error.message }),
        };
    }
}
