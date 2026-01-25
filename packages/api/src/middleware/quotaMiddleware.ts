/**
 * Quota middleware for demo limits.
 * Enforces document and query limits for free tier users in cloud mode.
 */

import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config/env.js';

// Extend Request to include usage
declare global {
    namespace Express {
        interface Request {
            usage?: {
                docsUsed: number;
                queriesUsed: number;
            };
        }
    }
}

// In-memory cache for local/dev mode
const usageCache = new Map<string, { docs: number; queries: number }>();

// Lazy-loaded DynamoDB client
let dynamoClient: any = null;

async function getDynamoClient() {
    if (dynamoClient) return dynamoClient;

    const config = getConfig();
    if (config.deployMode !== 'cloud') return null;

    try {
        // @ts-ignore - AWS SDK only available in cloud deployment
        const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
        // @ts-ignore - AWS SDK only available in cloud deployment
        const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

        const client = new DynamoDBClient({ region: config.awsRegion });
        dynamoClient = DynamoDBDocumentClient.from(client);
        return dynamoClient;
    } catch (e) {
        console.warn('DynamoDB not available, using in-memory cache');
        return null;
    }
}

/**
 * Get user usage from DynamoDB or cache.
 */
async function getUserUsage(userId: string): Promise<{ docs: number; queries: number }> {
    const config = getConfig();
    const tableName = process.env.DYNAMODB_TABLE_USERS;

    // Try DynamoDB in cloud mode
    if (config.deployMode === 'cloud' && tableName) {
        const client = await getDynamoClient();
        if (client) {
            try {
                // @ts-ignore - AWS SDK only available in cloud deployment
                const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
                const result = await client.send(new GetCommand({
                    TableName: tableName,
                    Key: { userId },
                }));

                const usage = {
                    docs: result.Item?.docsUsed || 0,
                    queries: result.Item?.queriesUsed || 0,
                };
                usageCache.set(userId, usage);
                return usage;
            } catch (e) {
                console.error('DynamoDB read failed:', e);
            }
        }
    }

    // Fallback to cache
    if (usageCache.has(userId)) {
        return usageCache.get(userId)!;
    }

    const usage = { docs: 0, queries: 0 };
    usageCache.set(userId, usage);
    return usage;
}

/**
 * Increment usage counter.
 */
async function incrementUsage(userId: string, type: 'docs' | 'queries'): Promise<void> {
    const config = getConfig();
    const tableName = process.env.DYNAMODB_TABLE_USERS;
    const field = type === 'docs' ? 'docsUsed' : 'queriesUsed';

    // Update cache
    const usage = await getUserUsage(userId);
    usage[type]++;
    usageCache.set(userId, usage);

    // Update DynamoDB in cloud mode
    if (config.deployMode === 'cloud' && tableName) {
        const client = await getDynamoClient();
        if (client) {
            try {
                // @ts-ignore - AWS SDK only available in cloud deployment
                const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
                await client.send(new UpdateCommand({
                    TableName: tableName,
                    Key: { userId },
                    UpdateExpression: `SET ${field} = if_not_exists(${field}, :zero) + :one`,
                    ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
                }));
            } catch (e) {
                console.error('DynamoDB update failed:', e);
            }
        }
    }
}

/**
 * Check document ingestion quota.
 */
export async function checkDocumentQuota(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const config = getConfig();

    // No limits in local or enterprise mode
    if (config.deployMode !== 'cloud') {
        return next();
    }

    // No limits for paid users
    if (req.user?.plan === 'pro' || req.user?.plan === 'unlimited') {
        return next();
    }

    const userId = req.user?.id;
    if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    const usage = await getUserUsage(userId);
    req.usage = { docsUsed: usage.docs, queriesUsed: usage.queries };

    if (usage.docs >= config.demoDocLimit) {
        res.status(403).json({
            error: 'Document limit reached',
            code: 'QUOTA_EXCEEDED',
            limitType: 'document',
            usage: {
                docsUsed: usage.docs,
                docsLimit: config.demoDocLimit,
            },
        });
        return;
    }

    next();
}

/**
 * Check query quota.
 */
export async function checkQueryQuota(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const config = getConfig();

    // No limits in local or enterprise mode
    if (config.deployMode !== 'cloud') {
        return next();
    }

    // No limits for paid users
    if (req.user?.plan === 'pro' || req.user?.plan === 'unlimited') {
        return next();
    }

    const userId = req.user?.id;
    if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    const usage = await getUserUsage(userId);
    req.usage = { docsUsed: usage.docs, queriesUsed: usage.queries };

    if (usage.queries >= config.demoQueryLimit) {
        res.status(403).json({
            error: 'Query limit reached',
            code: 'QUOTA_EXCEEDED',
            limitType: 'question',
            usage: {
                queriesUsed: usage.queries,
                queriesLimit: config.demoQueryLimit,
            },
        });
        return;
    }

    next();
}

/**
 * Record successful document ingestion.
 */
export async function recordDocumentUsage(userId: string): Promise<void> {
    await incrementUsage(userId, 'docs');
}

/**
 * Record successful query.
 */
export async function recordQueryUsage(userId: string): Promise<void> {
    await incrementUsage(userId, 'queries');
}

/**
 * Get usage endpoint handler.
 */
export async function getUsageHandler(
    req: Request,
    res: Response
): Promise<void> {
    const config = getConfig();

    // No tracking needed in non-cloud mode
    if (config.deployMode !== 'cloud') {
        res.json({
            docsUsed: 0,
            docsLimit: Infinity,
            queriesUsed: 0,
            queriesLimit: Infinity,
            plan: 'unlimited',
        });
        return;
    }

    const userId = req.user?.id;
    if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    const usage = await getUserUsage(userId);

    res.json({
        docsUsed: usage.docs,
        docsLimit: req.user?.plan === 'free' ? config.demoDocLimit : Infinity,
        queriesUsed: usage.queries,
        queriesLimit: req.user?.plan === 'free' ? config.demoQueryLimit : Infinity,
        plan: req.user?.plan,
    });
}
