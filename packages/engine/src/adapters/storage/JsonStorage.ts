import { readFile, writeFile, appendFile, mkdir, readdir, rm, access, stat, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { IStorage } from './IStorage.js';

/**
 * JSON-based file storage adapter
 * Provides simple file-based persistence for content atoms, trees, and nodes
 */
export class JsonStorage implements IStorage {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * Read a JSON file and parse it
   */
  async read<T>(filePath: string): Promise<T | null> {
    try {
      const fullPath = join(this.basePath, filePath);

      // Safety Check: Empty file?
      try {
        const stats = await stat(fullPath);
        if (stats.size === 0) {
          console.warn(`⚠️  Found empty file: ${filePath}. Treating as missing.`);
          return null;
        }
      } catch (e) {
        // File doesn't exist, which is fine
        return null;
      }

      const content = await readFile(fullPath, 'utf-8');
      return JSON.parse(content) as T;

    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
        return null;
      }

      // CORRUPTION RECOVERY
      if (error instanceof SyntaxError) {
        console.error(`💥 CORRUPTION DETECTED in ${filePath}: ${error.message}`);
        return null;
      }

      throw new Error(`Failed to read file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Write data to a JSON file ATOMICALLY
   * Writes to .tmp file then renames to avoid race conditions (empty reads)
   */
  async write<T>(filePath: string, data: T): Promise<void> {
    try {
      const fullPath = join(this.basePath, filePath);
      const dir = dirname(fullPath);
      // Create a unique temp file on the same volume
      const tempPath = `${fullPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Ensure directory exists
      await mkdir(dir, { recursive: true });

      // Write file with pretty formatting to TEMP path
      const jsonContent = JSON.stringify(data, null, 2);
      await writeFile(tempPath, jsonContent, 'utf-8');

      // Atomic rename: overwrite the target file instantly
      await rename(tempPath, fullPath);

    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a file
   */
  async delete(filePath: string): Promise<void> {
    try {
      const fullPath = join(this.basePath, filePath);
      await rm(fullPath, { force: true });
    } catch (error) {
      throw new Error(`Failed to delete file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List files in a directory
   */
  async list(dirPath: string): Promise<string[]> {
    try {
      const fullPath = join(this.basePath, dirPath);
      await mkdir(fullPath, { recursive: true }); // Ensure directory exists
      return await readdir(fullPath);
    } catch (error) {
      throw new Error(`Failed to list directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if a file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const fullPath = join(this.basePath, filePath);
      await access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure a directory exists
   */
  async ensureDir(dirPath: string): Promise<void> {
    try {
      const fullPath = join(this.basePath, dirPath);
      await mkdir(fullPath, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Append a line to a text file
   */
  async appendLine(filePath: string, line: string): Promise<void> {
    try {
      const fullPath = join(this.basePath, filePath);
      const dir = dirname(fullPath);

      // Ensure directory exists
      await mkdir(dir, { recursive: true });

      // Append line with newline
      await appendFile(fullPath, line + '\n', 'utf-8');
    } catch (error) {
      throw new Error(`Failed to append to file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the base path
   */
  getBasePath(): string {
    return this.basePath;
  }
}
