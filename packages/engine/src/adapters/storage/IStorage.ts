/**
 * Storage abstraction interface for hexagonal architecture.
 * Allows switching between filesystem (local), S3 (cloud/enterprise), or other backends.
 */
export interface IStorage {
    /**
     * Read and parse JSON from a file
     */
    read<T>(path: string): Promise<T | null>;

    /**
     * Write data as JSON to a file
     */
    write<T>(path: string, data: T): Promise<void>;

    /**
     * Delete a file
     */
    delete(path: string): Promise<void>;

    /**
     * List files in a directory (or with prefix for S3)
     */
    list(dir: string): Promise<string[]>;

    /**
     * Check if a file exists
     */
    exists(path: string): Promise<boolean>;

    /**
     * Ensure a directory exists (no-op for S3)
     */
    ensureDir(dirPath: string): Promise<void>;

    /**
     * Append a line to a text file
     */
    appendLine?(filePath: string, line: string): Promise<void>;

    /**
     * Get the base path (for compatibility)
     */
    getBasePath?(): string;
}
