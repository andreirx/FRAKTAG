/**
 * Authentication middleware.
 * Validates JWT in cloud mode, passes through in local/enterprise modes.
 */

import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config/env.js';

// Lazy-loaded DynamoDB client for fetching user plan
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
        console.warn('DynamoDB not available for auth');
        return null;
    }
}

/**
 * Fetch user plan from DynamoDB.
 */
async function fetchUserPlan(userId: string): Promise<'free' | 'pro' | 'unlimited'> {
    const tableName = process.env.DYNAMODB_TABLE_USERS;
    if (!tableName) return 'free';

    const client = await getDynamoClient();
    if (!client) return 'free';

    try {
        // @ts-ignore - AWS SDK only available in cloud deployment
        const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
        const result = await client.send(new GetCommand({
            TableName: tableName,
            Key: { userId },
        }));

        const plan = result.Item?.plan;
        if (plan === 'pro' || plan === 'unlimited') {
            return plan;
        }
        return 'free';
    } catch (e) {
        console.error('Failed to fetch user plan:', e);
        return 'free';
    }
}

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            user: {
                id: string;
                email?: string;
                plan: 'free' | 'pro' | 'unlimited';
                usageCount?: {
                    docs: number;
                    queries: number;
                };
            };
        }
    }
}

/**
 * Verify Cognito JWT token.
 * Uses AWS JWT verification or falls back to basic JWT parsing.
 */
async function verifyCognitoToken(token: string): Promise<{ sub: string; email?: string } | null> {
    const config = getConfig();

    if (!config.cognitoUserPoolId || !config.cognitoClientId) {
        console.error('Cognito configuration missing');
        return null;
    }

    try {
        // Try to use aws-jwt-verify if available (optional dependency)
        // @ts-ignore - Optional dependency, may not be installed
        const jwtVerify = await import('aws-jwt-verify').catch(() => null);

        if (jwtVerify) {
            const verifier = jwtVerify.CognitoJwtVerifier.create({
                userPoolId: config.cognitoUserPoolId,
                tokenUse: 'access',
                clientId: config.cognitoClientId,
            });

            const payload = await verifier.verify(token);
            return {
                sub: payload.sub,
                email: payload.email as string | undefined,
            };
        }

        // Fallback: Basic JWT parsing (less secure, for dev only)
        console.warn('aws-jwt-verify not installed, using basic JWT parsing');
        const parts = token.split('.');
        if (parts.length !== 3) {
            return null;
        }

        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

        // Basic expiry check
        if (payload.exp && payload.exp * 1000 < Date.now()) {
            console.error('Token expired');
            return null;
        }

        return {
            sub: payload.sub,
            email: payload.email,
        };
    } catch (error) {
        console.error('Token verification failed:', error);
        return null;
    }
}

/**
 * Main authentication middleware.
 */
export async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const config = getConfig();

    // LOCAL MODE: No auth required
    if (config.deployMode === 'local') {
        req.user = {
            id: 'local-admin',
            email: 'admin@local',
            plan: 'unlimited',
        };
        return next();
    }

    // ENTERPRISE MODE: Passthrough or custom SSO
    if (config.deployMode === 'enterprise') {
        // Check for custom header from VPN/proxy
        const enterpriseUserId = req.headers['x-enterprise-user-id'] as string;
        const enterpriseEmail = req.headers['x-enterprise-user-email'] as string;

        if (enterpriseUserId) {
            req.user = {
                id: enterpriseUserId,
                email: enterpriseEmail,
                plan: 'unlimited', // Enterprise users have unlimited access
            };
            return next();
        }

        // Default enterprise user if no header
        req.user = {
            id: 'enterprise-user',
            plan: 'unlimited',
        };
        return next();
    }

    // CLOUD MODE: Validate Cognito JWT
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authorization header required' });
        return;
    }

    const token = authHeader.substring(7);
    const decoded = await verifyCognitoToken(token);

    if (!decoded) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
    }

    // Fetch user plan from DynamoDB
    const plan = await fetchUserPlan(decoded.sub);

    req.user = {
        id: decoded.sub,
        email: decoded.email,
        plan,
    };

    next();
}

/**
 * Optional auth middleware - doesn't fail if no token, just sets user to null equivalent.
 */
export async function optionalAuthMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const config = getConfig();

    if (config.deployMode === 'local') {
        req.user = {
            id: 'local-admin',
            plan: 'unlimited',
        };
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // No auth provided, continue without user
        req.user = {
            id: 'anonymous',
            plan: 'free',
        };
        return next();
    }

    // Try to verify token
    const token = authHeader.substring(7);
    const decoded = await verifyCognitoToken(token);

    if (decoded) {
        const plan = await fetchUserPlan(decoded.sub);
        req.user = {
            id: decoded.sub,
            email: decoded.email,
            plan,
        };
    } else {
        req.user = {
            id: 'anonymous',
            plan: 'free',
        };
    }

    next();
}
