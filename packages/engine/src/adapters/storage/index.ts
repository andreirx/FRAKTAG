/**
 * Storage adapter factory and exports.
 * Creates the appropriate storage backend based on environment configuration.
 */

export { IStorage } from './IStorage.js';
export { JsonStorage } from './JsonStorage.js';
export { S3Storage, S3StorageConfig } from './S3Storage.js';

export type StorageType = 'fs' | 's3';

export interface StorageConfig {
    type: StorageType;
    // For fs
    basePath?: string;
    // For S3
    bucket?: string;
    prefix?: string;
    region?: string;
}

/**
 * Create a storage adapter based on configuration.
 * Reads from environment if config not fully specified.
 */
export function createStorage(config?: Partial<StorageConfig>): IStorage {
    const type = config?.type || (process.env.STORAGE_ADAPTER as StorageType) || 'fs';

    if (type === 's3') {
        const bucket = config?.bucket || process.env.S3_BUCKET_DATA;
        if (!bucket) {
            throw new Error('S3_BUCKET_DATA environment variable required for S3 storage');
        }

        // Dynamic import to avoid loading AWS SDK when not needed
        const { S3Storage } = require('./S3Storage.js');
        return new S3Storage({
            bucket,
            prefix: config?.prefix || process.env.STORAGE_PREFIX || '',
            region: config?.region || process.env.AWS_REGION || 'eu-central-1',
        });
    }

    // Default: filesystem storage
    const { JsonStorage } = require('./JsonStorage.js');
    const basePath = config?.basePath || process.env.STORAGE_ROOT || './data';
    return new JsonStorage(basePath);
}
