/**
 * Storage adapter factory and exports.
 * Creates the appropriate storage backend based on environment configuration.
 */

import { IStorage } from './IStorage.js';
import { JsonStorage } from './JsonStorage.js';

export { IStorage } from './IStorage.js';
export { JsonStorage } from './JsonStorage.js';

// S3Storage is loaded dynamically - only export the config type
export interface S3StorageConfig {
    bucket: string;
    prefix?: string;
    region?: string;
}

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
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { S3Storage } = require('./S3Storage.js');
        return new S3Storage({
            bucket,
            prefix: config?.prefix || process.env.STORAGE_PREFIX || '',
            region: config?.region || process.env.AWS_REGION || 'eu-central-1',
        }) as IStorage;
    }

    // Default: filesystem storage
    const basePath = config?.basePath || process.env.STORAGE_ROOT || './data';
    return new JsonStorage(basePath);
}
