/**
 * Paddle webhook handler for subscription events.
 * Updates user plan in DynamoDB based on payment status.
 *
 * NOTE: This file is ONLY for AWS Lambda cloud deployment.
 *
 * Events handled:
 * - subscription_created: New subscription
 * - subscription_updated: Plan change
 * - subscription_canceled: Cancellation
 * - subscription_payment_succeeded: Payment success
 * - subscription_payment_failed: Payment failure
 */

import { createHmac, timingSafeEqual } from 'crypto';

const region = process.env.AWS_REGION || 'eu-central-1';

// Lazy-loaded DynamoDB client
let dynamoClient: any = null;

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

interface PaddleWebhookEvent {
    event_type: string;
    event_id: string;
    occurred_at: string;
    data: {
        id: string;
        status: string;
        customer_id: string;
        custom_data?: {
            userId?: string;
        };
        items?: Array<{
            price: {
                id: string;
                product_id: string;
            };
        }>;
        scheduled_change?: {
            action: string;
            effective_at: string;
        };
    };
}

/**
 * Verify Paddle webhook signature.
 */
function verifySignature(payload: string, signature: string, secret: string): boolean {
    if (!signature || !secret) {
        console.warn('Missing signature or secret');
        return false;
    }

    try {
        // Paddle uses ts;h1= format
        const parts = signature.split(';');
        const tsMatch = parts.find(p => p.startsWith('ts='));
        const h1Match = parts.find(p => p.startsWith('h1='));

        if (!tsMatch || !h1Match) {
            console.error('Invalid signature format');
            return false;
        }

        const timestamp = tsMatch.substring(3);
        const hash = h1Match.substring(3);

        // Recreate signed payload
        const signedPayload = `${timestamp}:${payload}`;
        const expectedHash = createHmac('sha256', secret)
            .update(signedPayload)
            .digest('hex');

        // Timing-safe comparison
        const hashBuffer = Buffer.from(hash, 'hex');
        const expectedBuffer = Buffer.from(expectedHash, 'hex');

        if (hashBuffer.length !== expectedBuffer.length) {
            return false;
        }

        return timingSafeEqual(hashBuffer, expectedBuffer);
    } catch (error) {
        console.error('Signature verification error:', error);
        return false;
    }
}

/**
 * Update user plan in DynamoDB.
 */
async function updateUserPlan(
    userId: string,
    plan: 'free' | 'pro',
    subscriptionId?: string,
    subscriptionStatus?: string
): Promise<void> {
    const tableName = process.env.DYNAMODB_TABLE_USERS;
    if (!tableName) {
        console.error('DYNAMODB_TABLE_USERS not configured');
        return;
    }

    const client = await getDynamoClient();
    // @ts-ignore - AWS SDK only available in Lambda environment
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');

    await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { userId },
        UpdateExpression: 'SET #plan = :plan, subscriptionId = :subId, subscriptionStatus = :subStatus, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
            '#plan': 'plan',
        },
        ExpressionAttributeValues: {
            ':plan': plan,
            ':subId': subscriptionId || null,
            ':subStatus': subscriptionStatus || null,
            ':updatedAt': new Date().toISOString(),
        },
    }));

    console.log(`Updated user ${userId} to plan: ${plan}`);
}

/**
 * Reset user quotas when upgrading to pro.
 */
async function resetUserQuotas(userId: string): Promise<void> {
    const tableName = process.env.DYNAMODB_TABLE_USERS;
    if (!tableName) return;

    const client = await getDynamoClient();
    // @ts-ignore - AWS SDK only available in Lambda environment
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');

    await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { userId },
        UpdateExpression: 'SET docsUsed = :zero, queriesUsed = :zero',
        ExpressionAttributeValues: {
            ':zero': 0,
        },
    }));
}

export async function handler(event: any): Promise<any> {
    console.log('Paddle webhook received');

    // Verify signature
    const signature = event.headers['paddle-signature'] || '';
    const secret = process.env.PADDLE_WEBHOOK_SECRET || '';

    if (!verifySignature(event.body || '', signature, secret)) {
        console.error('Invalid webhook signature');
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Invalid signature' }),
        };
    }

    try {
        const payload: PaddleWebhookEvent = JSON.parse(event.body || '{}');
        const { event_type, data } = payload;

        console.log(`Processing event: ${event_type}`, JSON.stringify(data, null, 2));

        // Extract user ID from custom_data
        const userId = data.custom_data?.userId;
        if (!userId) {
            console.error('No userId in custom_data');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing userId' }),
            };
        }

        switch (event_type) {
            case 'subscription_created':
            case 'subscription_activated':
                await updateUserPlan(userId, 'pro', data.id, data.status);
                await resetUserQuotas(userId);
                break;

            case 'subscription_updated':
                // Check if still active
                if (data.status === 'active' || data.status === 'trialing') {
                    await updateUserPlan(userId, 'pro', data.id, data.status);
                } else if (data.status === 'canceled' || data.status === 'paused') {
                    // Check if there's a scheduled change (grace period)
                    if (data.scheduled_change?.action === 'cancel') {
                        // Keep pro until effective_at
                        console.log(`Subscription will cancel at ${data.scheduled_change.effective_at}`);
                    } else {
                        await updateUserPlan(userId, 'free', data.id, data.status);
                    }
                }
                break;

            case 'subscription_canceled':
                await updateUserPlan(userId, 'free', data.id, 'canceled');
                break;

            case 'subscription_payment_succeeded':
                // Ensure user has pro access
                await updateUserPlan(userId, 'pro', data.id, 'active');
                break;

            case 'subscription_payment_failed':
                console.warn(`Payment failed for user ${userId}`);
                // Don't immediately downgrade, Paddle handles retries
                break;

            default:
                console.log(`Unhandled event type: ${event_type}`);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ received: true }),
        };

    } catch (error: any) {
        console.error('Webhook processing error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
}
