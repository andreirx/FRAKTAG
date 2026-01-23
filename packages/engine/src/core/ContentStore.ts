// src/core/ContentStore.ts

import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { ContentAtom, ContentEditMode } from './types.js';
import { JsonStorage } from '../adapters/storage/JsonStorage.js';

export interface CreateContentOptions {
  payload: string;
  mediaType: string;
  sourceUri?: string;
  createdBy: string;
  supersedes?: string;
  editMode?: ContentEditMode;  // Default: 'readonly'
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
    const now = new Date().toISOString();

    const atom: ContentAtom = {
      id,
      hash,
      payload: options.payload,
      mediaType: options.mediaType,
      sourceUri: options.sourceUri,
      createdAt: now,
      createdBy: options.createdBy,
      updatedAt: now,
      supersedes: options.supersedes,
      editMode: options.editMode || 'readonly',
      metadata: options.metadata || {},
    };

    // If this supersedes another atom, mark that atom as superseded
    if (options.supersedes) {
      const oldAtom = await this.get(options.supersedes);
      if (oldAtom) {
        oldAtom.supersededBy = id;
        await this.storage.write(`content/${options.supersedes}.json`, oldAtom);
      }
    }

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
   * Prune content atoms marked as derived chunks.
   * Keeps original uploads.
   * @returns Number of atoms deleted
   */
  async pruneDerived(): Promise<number> {
    const ids = await this.listIds();
    let count = 0;

    for (const id of ids) {
      const atom = await this.get(id);
      if (atom?.metadata?.isDerivedChunk) {
        await this.delete(id);
        count++;
      }
    }
    return count;
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

  // ============ EDITABLE CONTENT ============

  /**
   * Update the payload of an editable content atom
   * Returns null if content doesn't exist or is not editable
   */
  async updatePayload(id: string, newPayload: string): Promise<ContentAtom | null> {
    const atom = await this.get(id);
    if (!atom) {
      return null;
    }

    if (atom.editMode !== 'editable') {
      throw new Error(`Content ${id} is read-only. Use createVersion() to replace it.`);
    }

    atom.payload = newPayload;
    atom.hash = this.calculateHash(newPayload);
    atom.updatedAt = new Date().toISOString();

    await this.storage.write(`content/${id}.json`, atom);
    return atom;
  }

  // ============ VERSIONING ============

  /**
   * Create a new version of content that supersedes an existing one
   * The old content is marked as superseded but not deleted
   * Returns the new content atom
   */
  async createVersion(
    oldContentId: string,
    newPayload: string,
    createdBy: string
  ): Promise<ContentAtom> {
    const oldAtom = await this.get(oldContentId);
    if (!oldAtom) {
      throw new Error(`Content not found: ${oldContentId}`);
    }

    // Create new atom that supersedes the old one
    const newAtom = await this.create({
      payload: newPayload,
      mediaType: oldAtom.mediaType,
      sourceUri: oldAtom.sourceUri,
      createdBy,
      supersedes: oldContentId,
      editMode: oldAtom.editMode,  // Preserve edit mode
      metadata: {
        ...oldAtom.metadata,
        versionNumber: ((oldAtom.metadata.versionNumber as number) || 1) + 1,
      },
    });

    return newAtom;
  }

  /**
   * Get the version history of a content atom
   * Returns array from oldest to newest, with the queried content's lineage
   */
  async getHistory(contentId: string): Promise<ContentAtom[]> {
    const history: ContentAtom[] = [];
    const visited = new Set<string>();

    // First, walk backwards to find the original
    let current = await this.get(contentId);
    const forwardChain: ContentAtom[] = [];

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      forwardChain.unshift(current);  // Add to front

      if (current.supersedes) {
        current = await this.get(current.supersedes);
      } else {
        break;
      }
    }

    history.push(...forwardChain);

    // Then walk forwards from the queried content to find newer versions
    current = await this.get(contentId);
    if (current?.supersededBy) {
      current = await this.get(current.supersededBy);

      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        history.push(current);

        if (current.supersededBy) {
          current = await this.get(current.supersededBy);
        } else {
          break;
        }
      }
    }

    return history;
  }

  /**
   * Get the latest version of a content atom
   * Follows the supersededBy chain to the end
   */
  async getLatestVersion(contentId: string): Promise<ContentAtom | null> {
    let current = await this.get(contentId);

    while (current?.supersededBy) {
      const next = await this.get(current.supersededBy);
      if (!next) break;
      current = next;
    }

    return current;
  }

  /**
   * Check if a content atom has been superseded
   */
  async isSuperseded(contentId: string): Promise<boolean> {
    const atom = await this.get(contentId);
    return atom?.supersededBy !== undefined;
  }
}
