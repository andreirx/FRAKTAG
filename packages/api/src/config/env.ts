/**
 * Centralized environment configuration with validation.
 * Supports local, cloud (AWS), and enterprise deployment modes.
 */

export type DeployMode = 'local' | 'cloud' | 'enterprise';
export type StorageAdapter = 'fs' | 's3';

export interface EnvConfig {
    // Deployment mode
    deployMode: DeployMode;

    // Storage configuration
    storageAdapter: StorageAdapter;
    storageRoot: string;

    // AWS configuration (cloud mode)
    awsRegion: string;
    cognitoUserPoolId?: string;
    cognitoClientId?: string;
    s3BucketData?: string;

    // Secrets
    openaiApiKey?: string;
    openaiSecretArn?: string;

    // Paddle (monetization)
    paddleWebhookSecret?: string;
    paddleApiKey?: string;

    // Limits for demo mode
    demoDocLimit: number;
    demoQueryLimit: number;

    // Server
    port: number;
    corsOrigin: string;
}

/**
 * Validate and load environment configuration.
 * Throws if required variables are missing for the deploy mode.
 */
export function loadEnvConfig(): EnvConfig {
    const deployMode = (process.env.FRAKTAG_DEPLOY_MODE || 'local') as DeployMode;
    const storageAdapter = (process.env.STORAGE_ADAPTER || 'fs') as StorageAdapter;

    const config: EnvConfig = {
        deployMode,
        storageAdapter,
        storageRoot: process.env.STORAGE_ROOT || './data',

        awsRegion: process.env.AWS_REGION || 'eu-central-1',
        cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
        cognitoClientId: process.env.COGNITO_CLIENT_ID,
        s3BucketData: process.env.S3_BUCKET_DATA,

        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiSecretArn: process.env.OPENAI_SECRET_ARN,

        paddleWebhookSecret: process.env.PADDLE_WEBHOOK_SECRET,
        paddleApiKey: process.env.PADDLE_API_KEY,

        demoDocLimit: parseInt(process.env.DEMO_DOC_LIMIT || '1', 10),
        demoQueryLimit: parseInt(process.env.DEMO_QUERY_LIMIT || '1', 10),

        port: parseInt(process.env.PORT || '3001', 10),
        corsOrigin: process.env.CORS_ORIGIN || '*',
    };

    // Validate based on deploy mode
    validateConfig(config);

    return config;
}

/**
 * Validate configuration for the current deploy mode.
 */
function validateConfig(config: EnvConfig): void {
    const errors: string[] = [];

    // All modes need LLM access
    if (!config.openaiApiKey && !config.openaiSecretArn) {
        errors.push('OPENAI_API_KEY or OPENAI_SECRET_ARN required');
    }

    // Cloud mode requirements
    if (config.deployMode === 'cloud') {
        if (!config.cognitoUserPoolId) {
            errors.push('COGNITO_USER_POOL_ID required for cloud mode');
        }
        if (!config.cognitoClientId) {
            errors.push('COGNITO_CLIENT_ID required for cloud mode');
        }
        if (config.storageAdapter === 's3' && !config.s3BucketData) {
            errors.push('S3_BUCKET_DATA required for S3 storage in cloud mode');
        }
    }

    // Enterprise with S3
    if (config.deployMode === 'enterprise' && config.storageAdapter === 's3') {
        if (!config.s3BucketData) {
            errors.push('S3_BUCKET_DATA required for S3 storage in enterprise mode');
        }
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n  - ${errors.join('\n  - ')}`);
    }
}

/**
 * Get a user-friendly description of the current mode.
 */
export function getModeDescription(config: EnvConfig): string {
    const storage = config.storageAdapter === 's3'
        ? `S3 (${config.s3BucketData})`
        : `Filesystem (${config.storageRoot})`;

    const auth = config.deployMode === 'cloud'
        ? 'Cognito'
        : config.deployMode === 'enterprise'
            ? 'Enterprise (configurable)'
            : 'None (local)';

    return `Mode: ${config.deployMode} | Storage: ${storage} | Auth: ${auth}`;
}

// Singleton config instance
let cachedConfig: EnvConfig | null = null;

export function getConfig(): EnvConfig {
    if (!cachedConfig) {
        cachedConfig = loadEnvConfig();
    }
    return cachedConfig;
}

// Export for convenience
export const config = getConfig;
