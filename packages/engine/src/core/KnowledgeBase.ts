// src/core/KnowledgeBase.ts
// Self-contained, portable knowledge base

import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { KnowledgeBaseConfig, SeedFolder, TreeConfig } from './types.js';
import { JsonStorage } from '../adapters/storage/JsonStorage.js';

/**
 * Represents a self-contained, portable knowledge base.
 * Each KB has its own:
 * - kb.json (identity and organizing principles)
 * - content/ (content atoms)
 * - indexes/ (vector embeddings)
 * - trees/ (tree structures, can have multiple)
 */
export class KnowledgeBase {
  readonly path: string;
  readonly config: KnowledgeBaseConfig;
  readonly storage: JsonStorage;

  private constructor(path: string, config: KnowledgeBaseConfig, storage: JsonStorage) {
    this.path = path;
    this.config = config;
    this.storage = storage;
  }

  // ============ FACTORY METHODS ============

  /**
   * Load an existing knowledge base from a directory
   */
  static async load(kbPath: string): Promise<KnowledgeBase> {
    const absolutePath = resolve(kbPath);
    const configPath = join(absolutePath, 'kb.json');

    if (!existsSync(configPath)) {
      throw new Error(`Knowledge base not found at ${absolutePath}. Missing kb.json`);
    }

    const configContent = await readFile(configPath, 'utf-8');
    const config: KnowledgeBaseConfig = JSON.parse(configContent);

    const storage = new JsonStorage(absolutePath);

    // Ensure directories exist
    await storage.ensureDir('content');
    await storage.ensureDir('indexes');
    await storage.ensureDir('trees');

    return new KnowledgeBase(absolutePath, config, storage);
  }

  /**
   * Create a new knowledge base
   */
  static async create(
    kbPath: string,
    options: {
      id: string;
      name: string;
      organizingPrinciple: string;
      seedFolders?: SeedFolder[];
      dogma?: KnowledgeBaseConfig['dogma'];
    }
  ): Promise<KnowledgeBase> {
    const absolutePath = resolve(kbPath);

    // Check if already exists
    if (existsSync(join(absolutePath, 'kb.json'))) {
      throw new Error(`Knowledge base already exists at ${absolutePath}`);
    }

    // Create directory structure
    await mkdir(absolutePath, { recursive: true });
    await mkdir(join(absolutePath, 'content'), { recursive: true });
    await mkdir(join(absolutePath, 'indexes'), { recursive: true });
    await mkdir(join(absolutePath, 'trees'), { recursive: true });

    // Create kb.json
    const config: KnowledgeBaseConfig = {
      id: options.id,
      name: options.name,
      organizingPrinciple: options.organizingPrinciple,
      defaultTreeId: 'main',
      seedFolders: options.seedFolders || [],
      dogma: options.dogma,
    };

    await writeFile(
      join(absolutePath, 'kb.json'),
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    const storage = new JsonStorage(absolutePath);

    console.log(`✅ Created knowledge base "${options.name}" at ${absolutePath}`);

    return new KnowledgeBase(absolutePath, config, storage);
  }

  // ============ ACCESSORS ============

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get organizingPrinciple(): string {
    return this.config.organizingPrinciple;
  }

  get defaultTreeId(): string {
    return this.config.defaultTreeId || 'main';
  }

  // ============ TREE MANAGEMENT ============

  /**
   * Get tree config for creating/initializing a tree in this KB
   */
  getTreeConfig(treeId?: string): TreeConfig {
    const id = treeId || this.defaultTreeId;
    return {
      id,
      name: this.config.name + (id !== 'main' ? ` (${id})` : ''),
      organizingPrinciple: this.config.organizingPrinciple,
      autoPlace: false,
      seedFolders: this.config.seedFolders,
      dogma: this.config.dogma,
    };
  }

  /**
   * List all trees in this KB
   */
  async listTrees(): Promise<string[]> {
    const files = await this.storage.list('trees');
    return files
      .filter(f => f.endsWith('.json') && !f.endsWith('.audit.log'))
      .map(f => f.replace('trees/', '').replace('.json', ''));
  }

  /**
   * Check if a tree exists in this KB
   */
  async hasTree(treeId: string): Promise<boolean> {
    return this.storage.exists(`trees/${treeId}.json`);
  }

  // ============ PATH HELPERS ============

  /**
   * Get the full path to a file within the KB
   */
  getPath(relativePath: string): string {
    return join(this.path, relativePath);
  }

  /**
   * Get content directory path
   */
  get contentPath(): string {
    return join(this.path, 'content');
  }

  /**
   * Get indexes directory path
   */
  get indexesPath(): string {
    return join(this.path, 'indexes');
  }

  /**
   * Get trees directory path
   */
  get treesPath(): string {
    return join(this.path, 'trees');
  }

  // ============ SERIALIZATION ============

  /**
   * Save any changes to kb.json
   */
  async save(): Promise<void> {
    await writeFile(
      join(this.path, 'kb.json'),
      JSON.stringify(this.config, null, 2),
      'utf-8'
    );
  }

  /**
   * Export KB info for API responses
   */
  toJSON(): {
    id: string;
    name: string;
    path: string;
    organizingPrinciple: string;
    defaultTreeId: string;
  } {
    return {
      id: this.config.id,
      name: this.config.name,
      path: this.path,
      organizingPrinciple: this.config.organizingPrinciple,
      defaultTreeId: this.defaultTreeId,
    };
  }
}

/**
 * Manager for multiple knowledge bases
 */
export class KnowledgeBaseManager {
  private knowledgeBases: Map<string, KnowledgeBase> = new Map();
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = resolve(basePath);
  }

  /**
   * Load all KBs from paths specified in config
   */
  async loadFromPaths(paths: string[]): Promise<void> {
    for (const kbPath of paths) {
      try {
        const absolutePath = resolve(this.basePath, kbPath);
        const kb = await KnowledgeBase.load(absolutePath);
        this.knowledgeBases.set(kb.id, kb);
        console.log(`📚 Loaded KB: ${kb.name} (${kb.id})`);
      } catch (error: any) {
        console.warn(`⚠️ Failed to load KB from ${kbPath}: ${error.message}`);
      }
    }
  }

  /**
   * Create a new KB and add it to the manager
   */
  async create(
    relativePath: string,
    options: {
      id: string;
      name: string;
      organizingPrinciple: string;
      seedFolders?: SeedFolder[];
      dogma?: KnowledgeBaseConfig['dogma'];
    }
  ): Promise<KnowledgeBase> {
    const absolutePath = resolve(this.basePath, relativePath);
    const kb = await KnowledgeBase.create(absolutePath, options);
    this.knowledgeBases.set(kb.id, kb);
    return kb;
  }

  /**
   * Get a KB by ID
   */
  get(id: string): KnowledgeBase | undefined {
    return this.knowledgeBases.get(id);
  }

  /**
   * List all loaded KBs
   */
  list(): KnowledgeBase[] {
    return Array.from(this.knowledgeBases.values());
  }

  /**
   * Check if a KB exists
   */
  has(id: string): boolean {
    return this.knowledgeBases.has(id);
  }

  /**
   * Get all KB IDs
   */
  ids(): string[] {
    return Array.from(this.knowledgeBases.keys());
  }
}
