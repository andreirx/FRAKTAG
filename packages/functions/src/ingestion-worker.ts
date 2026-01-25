/**
 * AWS Lambda handler for async PDF/document ingestion.
 * Triggered by S3 upload events via EventBridge.
 *
 * NOTE: This file is ONLY for AWS Lambda cloud deployment.
 * For local development, use the regular API server in packages/api.
 *
 * Flow:
 * 1. User uploads to S3 staging/{userId}/ via pre-signed URL
 * 2. S3 Event → EventBridge → This Lambda
 * 3. Process document with Fraktag engine
 * 4. Move processed data to clean/{userId}/kb-id/
 * 5. Update DynamoDB job status
 * 6. Optional: Send email via SES
 */

const region = process.env.AWS_REGION || 'eu-central-1';

// Lazy-loaded clients
let s3Client: any = null;
let dynamoClient: any = null;
let sesClient: any = null;
let fraktag: any = null;

async function getS3Client() {
    if (!s3Client) {
        // @ts-ignore - AWS SDK only available in Lambda environment
        const { S3Client } = await import('@aws-sdk/client-s3');
        s3Client = new S3Client({ region });
    }
    return s3Client;
}

async function getDynamoClient() {
    if (!dynamoClient) {
        // @ts-ignore - AWS SDK only available in Lambda environment
        const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
        // @ts-ignore - AWS SDK only available in Lambda environment
        const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
        dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    }
    return dynamoClient;
}

async function getSESClient() {
    if (!sesClient) {
        // @ts-ignore - AWS SDK only available in Lambda environment
        const { SESClient } = await import('@aws-sdk/client-ses');
        sesClient = new SESClient({ region });
    }
    return sesClient;
}

async function initFraktag() {
    if (!fraktag) {
        process.env.FRAKTAG_DEPLOY_MODE = 'cloud';
        process.env.STORAGE_ADAPTER = 's3';

        // Fetch OpenAI key from Secrets Manager
        if (process.env.OPENAI_SECRET_ARN && !process.env.OPENAI_API_KEY) {
            try {
                // @ts-ignore - AWS SDK only available in Lambda environment
                const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
                const secretsClient = new SecretsManagerClient({ region });
                const response = await secretsClient.send(new GetSecretValueCommand({
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

        const config: any = {
            instanceId: process.env.FRAKTAG_INSTANCE_ID || 'lambda-worker',
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

interface IngestionJob {
    jobId: string;
    userId: string;
    fileName: string;
    s3Key: string;
    treeId: string;
    folderId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
    createdAt: string;
    completedAt?: string;
}

async function updateJobStatus(
    jobId: string,
    status: IngestionJob['status'],
    error?: string
): Promise<void> {
    const tableName = process.env.DYNAMODB_TABLE_JOBS;
    if (!tableName) {
        console.warn('DYNAMODB_TABLE_JOBS not set, skipping status update');
        return;
    }

    const client = await getDynamoClient();
    // @ts-ignore - AWS SDK only available in Lambda environment
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');

    await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { jobId },
        UpdateExpression: 'SET #status = :status, completedAt = :completedAt' +
            (error ? ', #error = :error' : ''),
        ExpressionAttributeNames: {
            '#status': 'status',
            ...(error && { '#error': 'error' }),
        },
        ExpressionAttributeValues: {
            ':status': status,
            ':completedAt': new Date().toISOString(),
            ...(error && { ':error': error }),
        },
    }));
}

async function getJob(jobId: string): Promise<IngestionJob | null> {
    const tableName = process.env.DYNAMODB_TABLE_JOBS;
    if (!tableName) return null;

    const client = await getDynamoClient();
    // @ts-ignore - AWS SDK only available in Lambda environment
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');

    const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: { jobId },
    }));

    return result.Item as IngestionJob | null;
}

async function sendCompletionEmail(userId: string, fileName: string, success: boolean): Promise<void> {
    const tableName = process.env.DYNAMODB_TABLE_USERS;
    if (!tableName) return;

    const dynamoDb = await getDynamoClient();
    // @ts-ignore - AWS SDK only available in Lambda environment
    const { GetCommand: GetCmd } = await import('@aws-sdk/lib-dynamodb');

    // Get user email
    const userResult = await dynamoDb.send(new GetCmd({
        TableName: tableName,
        Key: { userId },
    }));

    const email = userResult.Item?.email;
    if (!email) return;

    const senderEmail = process.env.SES_SENDER_EMAIL;
    if (!senderEmail) return;

    try {
        const ses = await getSESClient();
        // @ts-ignore - AWS SDK only available in Lambda environment
        const { SendEmailCommand } = await import('@aws-sdk/client-ses');

        await ses.send(new SendEmailCommand({
            Source: senderEmail,
            Destination: { ToAddresses: [email] },
            Message: {
                Subject: {
                    Data: success
                        ? `FRAKTAG: "${fileName}" processed successfully`
                        : `FRAKTAG: Failed to process "${fileName}"`,
                },
                Body: {
                    Text: {
                        Data: success
                            ? `Your document "${fileName}" has been processed and added to your knowledge base. You can now query it!`
                            : `We encountered an error processing "${fileName}". Please try uploading again or contact support.`,
                    },
                },
            },
        }));
    } catch (error) {
        console.error('Failed to send email:', error);
    }
}

export async function handler(event: any, context: any): Promise<void> {
    if (context) context.callbackWaitsForEmptyEventLoop = false;

    console.log('Ingestion worker received event:', JSON.stringify(event, null, 2));

    // @ts-ignore - AWS SDK only available in Lambda environment
    const { GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await getS3Client();

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

        console.log(`Processing: s3://${bucket}/${key}`);

        // Extract job ID from key: staging/{userId}/{jobId}/{fileName}
        const keyParts = key.split('/');
        if (keyParts.length < 4 || keyParts[0] !== 'staging') {
            console.log('Skipping non-staging key:', key);
            continue;
        }

        const userId = keyParts[1];
        const jobId = keyParts[2];
        const fileName = keyParts.slice(3).join('/');

        try {
            // Update job status to processing
            await updateJobStatus(jobId, 'processing');

            // Get job details from DynamoDB
            const job = await getJob(jobId);
            if (!job) {
                console.error(`Job not found: ${jobId}`);
                continue;
            }

            // Download file from S3
            const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
            const response = await s3.send(getCommand);
            const fileBuffer = await response.Body?.transformToByteArray();

            if (!fileBuffer) {
                throw new Error('Failed to download file');
            }

            // Initialize Fraktag with user-specific storage prefix
            const engine = await initFraktag();

            // Parse the file
            const text = await engine.parseFile(fileName, Buffer.from(fileBuffer));
            if (!text) {
                throw new Error('Failed to parse document');
            }

            // Ingest into tree
            console.log(`Ingesting document for user ${userId}, tree ${job.treeId}, folder ${job.folderId}`);

            await engine.ingestDocument(
                text,
                job.treeId,
                job.folderId,
                fileName.split('/').pop() || fileName
            );

            // Delete staging file
            await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

            // Update job status
            await updateJobStatus(jobId, 'completed');

            // Send completion email
            await sendCompletionEmail(userId, fileName, true);

            console.log(`Successfully processed: ${fileName}`);

        } catch (error: any) {
            console.error(`Failed to process ${key}:`, error);
            await updateJobStatus(jobId, 'failed', error.message);
            await sendCompletionEmail(userId, fileName, false);
        }
    }
}
