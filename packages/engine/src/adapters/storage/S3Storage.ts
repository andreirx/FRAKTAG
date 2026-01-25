/**
 * S3-based storage adapter for cloud/enterprise deployments.
 * Implements IStorage interface for AWS S3 backend.
 */

import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { IStorage } from './IStorage.js';

export interface S3StorageConfig {
    bucket: string;
    prefix?: string;  // e.g., 'tenants/{userId}/' for multi-tenancy
    region?: string;
}

export class S3Storage implements IStorage {
    private client: S3Client;
    private bucket: string;
    private prefix: string;

    constructor(config: S3StorageConfig) {
        this.bucket = config.bucket;
        this.prefix = config.prefix || '';
        this.client = new S3Client({
            region: config.region || process.env.AWS_REGION || 'eu-central-1',
        });
    }

    /**
     * Resolve full S3 key from relative path
     */
    private getKey(path: string): string {
        // Normalize path separators and join with prefix
        const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
        return this.prefix ? `${this.prefix.replace(/\/+$/, '')}/${normalized}` : normalized;
    }

    /**
     * Read and parse JSON from S3
     */
    async read<T>(path: string): Promise<T | null> {
        try {
            const key = this.getKey(path);
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            const response = await this.client.send(command);
            const content = await response.Body?.transformToString('utf-8');

            if (!content) {
                console.warn(`⚠️  Empty content for key: ${key}`);
                return null;
            }

            return JSON.parse(content) as T;
        } catch (error: any) {
            if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
                return null;
            }

            // JSON parse error - corruption
            if (error instanceof SyntaxError) {
                console.error(`💥 CORRUPTION DETECTED in S3 key ${this.getKey(path)}: ${error.message}`);
                console.warn(`   🗑️  Deleting corrupted object to allow regeneration.`);
                try {
                    await this.delete(path);
                } catch (delError) {
                    console.error(`   ❌ Failed to delete corrupted object:`, delError);
                }
                return null;
            }

            throw new Error(`Failed to read from S3 ${path}: ${error.message}`);
        }
    }

    /**
     * Write data as JSON to S3
     */
    async write<T>(path: string, data: T): Promise<void> {
        try {
            const key = this.getKey(path);
            const jsonContent = JSON.stringify(data, null, 2);

            const command = new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: jsonContent,
                ContentType: 'application/json',
            });

            await this.client.send(command);
        } catch (error: any) {
            throw new Error(`Failed to write to S3 ${path}: ${error.message}`);
        }
    }

    /**
     * Delete an object from S3
     */
    async delete(path: string): Promise<void> {
        try {
            const key = this.getKey(path);
            const command = new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            await this.client.send(command);
        } catch (error: any) {
            throw new Error(`Failed to delete from S3 ${path}: ${error.message}`);
        }
    }

    /**
     * List objects with a given prefix
     */
    async list(dirPath: string): Promise<string[]> {
        try {
            const prefix = this.getKey(dirPath);
            const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;

            const command = new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: normalizedPrefix,
                Delimiter: '/',
            });

            const response = await this.client.send(command);

            // Return file names (not full keys)
            const files: string[] = [];

            // Add files
            if (response.Contents) {
                for (const obj of response.Contents) {
                    if (obj.Key) {
                        const fileName = obj.Key.replace(normalizedPrefix, '').split('/')[0];
                        if (fileName && !files.includes(fileName)) {
                            files.push(fileName);
                        }
                    }
                }
            }

            // Add "directories" (common prefixes)
            if (response.CommonPrefixes) {
                for (const prefix of response.CommonPrefixes) {
                    if (prefix.Prefix) {
                        const dirName = prefix.Prefix.replace(normalizedPrefix, '').replace(/\/$/, '');
                        if (dirName && !files.includes(dirName)) {
                            files.push(dirName);
                        }
                    }
                }
            }

            return files;
        } catch (error: any) {
            throw new Error(`Failed to list S3 prefix ${dirPath}: ${error.message}`);
        }
    }

    /**
     * Check if an object exists in S3
     */
    async exists(path: string): Promise<boolean> {
        try {
            const key = this.getKey(path);
            const command = new HeadObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            await this.client.send(command);
            return true;
        } catch (error: any) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Ensure directory exists - no-op for S3 (directories are virtual)
     */
    async ensureDir(_dirPath: string): Promise<void> {
        // S3 doesn't have real directories, they're just key prefixes
        // No action needed
    }

    /**
     * Append a line to a text file
     * Note: S3 doesn't support append, so we read-modify-write
     */
    async appendLine(filePath: string, line: string): Promise<void> {
        try {
            const key = this.getKey(filePath);

            // Try to read existing content
            let existingContent = '';
            try {
                const getCommand = new GetObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                });
                const response = await this.client.send(getCommand);
                existingContent = await response.Body?.transformToString('utf-8') || '';
            } catch (error: any) {
                if (error.name !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) {
                    throw error;
                }
                // File doesn't exist, start fresh
            }

            // Append line and write back
            const newContent = existingContent + line + '\n';
            const putCommand = new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: newContent,
                ContentType: 'text/plain',
            });

            await this.client.send(putCommand);
        } catch (error: any) {
            throw new Error(`Failed to append to S3 ${filePath}: ${error.message}`);
        }
    }

    /**
     * Get the base path (bucket + prefix for compatibility)
     */
    getBasePath(): string {
        return `s3://${this.bucket}/${this.prefix}`;
    }
}
