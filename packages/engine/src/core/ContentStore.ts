// src/core/ContentStore.ts

import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { ContentAtom } from './types.js';
import { JsonStorage } from '../adapters/storage/JsonStorage.js';

export interface CreateContentOptions {
  payload: string;
  mediaType: string;
  sourceUri?: string;
  createdBy: string;
  supersedes?: string;
  metadata?: Record<string, unknown>;
}

/**
 * ContentStore manages immutable content atoms
 */
export class ContentStore {
  private storage: JsonStorage;

  constructor(storage: JsonStorage) {
    this.storage = storage;
  }

  /**
   * Create a new content atom
   */
  async create(options: CreateContentOptions & { customId?: string }): Promise<ContentAtom> {
    const id = options.customId || randomUUID();
    const hash = this.calculateHash(options.payload);

    const atom: ContentAtom = {
      id,
      hash,
      payload: options.payload,
      mediaType: options.mediaType,
      sourceUri: options.sourceUri,
      createdAt: new Date().toISOString(),
      createdBy: options.createdBy,
      supersedes: options.supersedes,
      metadata: options.metadata || {},
    };

    await this.storage.write(`content/${id}.json`, atom);
    return atom;
  }

  /**
   * Get a content atom by ID
   */
  async get(id: string): Promise<ContentAtom | null> {
    return await this.storage.read<ContentAtom>(`content/${id}.json`);
  }

  /**
   * Delete a content atom
   */
  async delete(id: string): Promise<void> {
    await this.storage.delete(`content/${id}.json`);
  }

  /**
   * List all content atom IDs
   */
  async listIds(): Promise<string[]> {
    const files = await this.storage.list('content');
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * Find content atoms by hash (for deduplication)
   */
  async findByHash(hash: string): Promise<ContentAtom[]> {
    const ids = await this.listIds();
    const atoms: ContentAtom[] = [];

    for (const id of ids) {
      const atom = await this.get(id);
      if (atom && atom.hash === hash) {
        atoms.push(atom);
      }
    }

    return atoms;
  }

  /**
   * Update content atom metadata (content itself is immutable)
   */
  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<ContentAtom | null> {
    const atom = await this.get(id);
    if (!atom) {
      return null;
    }

    atom.metadata = { ...atom.metadata, ...metadata };
    await this.storage.write(`content/${id}.json`, atom);
    return atom;
  }

  /**
   * Calculate SHA-256 hash of content
   * Public to allow external deduplication checks
   */
  calculateHash(content: string): string {
    const hash = createHash('sha256');
    hash.update(content, 'utf-8');
    return `sha256:${hash.digest('hex')}`;
  }
}
