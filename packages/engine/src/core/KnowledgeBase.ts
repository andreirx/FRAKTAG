// src/core/KnowledgeBase.ts
// Self-contained, portable knowledge base

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { resolve, join, basename } from 'path';
import { existsSync } from 'fs';
import { KnowledgeBaseConfig, SeedFolder, TreeConfig, Tree } from './types.js';
import { JsonStorage } from '../adapters/storage/JsonStorage.js';
import { TreeStore } from './TreeStore.js';
import { ContentStore } from './ContentStore.js';

/**
 * Info about a discovered knowledge base (before loading)
 */
export interface DiscoveredKB {
  id: string;
  name: string;
  path: string;
  folderName: string;
  organizingPrinciple: string;
  isLoaded: boolean;
}

/**
 * Represents a self-contained, portable knowledge base.
 * Each KB has its own:
 * - kb.json (identity and organizing principles)
 * - content/ (content atoms)
 * - indexes/ (vector embeddings)
 * - trees/ (tree structures, can have multiple)
 *
 * PORTABLE: All data lives within the KB folder, making it easy to
 * copy, backup, or share entire knowledge bases.
 */
export class KnowledgeBase {
  readonly path: string;
  readonly config: KnowledgeBaseConfig;
  readonly storage: JsonStorage;
  readonly treeStore: TreeStore;
  readonly contentStore: ContentStore;

  private constructor(path: string, config: KnowledgeBaseConfig, storage: JsonStorage) {
    this.path = path;
    this.config = config;
    this.storage = storage;
    // Each KB has its own TreeStore and ContentStore using its local storage
    this.treeStore = new TreeStore(storage);
    this.contentStore = new ContentStore(storage);
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
   * Get the full tree ID (prefixed with KB ID) from a local tree ID.
   * This ensures tree IDs are globally unique across KBs.
   * E.g., "main" in KB "kb-my-projects-xyz" becomes "kb-my-projects-xyz-main"
   */
  getFullTreeId(localTreeId?: string): string {
    const local = localTreeId || this.defaultTreeId;
    return `${this.config.id}-${local}`;
  }

  /**
   * Get tree config for creating/initializing a tree in this KB.
   * The tree ID is prefixed with the KB ID to ensure global uniqueness.
   */
  getTreeConfig(localTreeId?: string): TreeConfig {
    const local = localTreeId || this.defaultTreeId;
    const fullId = this.getFullTreeId(local);
    return {
      id: fullId,
      name: this.config.name + (local !== 'main' ? ` (${local})` : ''),
      organizingPrinciple: this.config.organizingPrinciple,
      autoPlace: false,
      seedFolders: this.config.seedFolders,
      dogma: this.config.dogma,
      kbId: this.config.id, // Track which KB owns this tree
    };
  }

  /**
   * Create a tree in this KB using the KB's local storage.
   * The tree is stored in this KB's trees/ folder.
   */
  async createTree(localTreeId?: string): Promise<Tree> {
    const config = this.getTreeConfig(localTreeId);
    return await this.treeStore.createTree(config);
  }

  /**
   * List all trees in this KB (returns full Tree objects)
   */
  async listTrees(): Promise<Tree[]> {
    return await this.treeStore.listTrees();
  }

  /**
   * List tree IDs in this KB
   */
  async listTreeIds(): Promise<string[]> {
    const trees = await this.treeStore.listTrees();
    return trees.map(t => t.id);
  }

  /**
   * Check if a tree exists in this KB
   */
  async hasTree(treeId: string): Promise<boolean> {
    return this.treeStore.treeExists(treeId);
  }

  /**
   * Get a tree from this KB
   */
  async getTree(treeId: string): Promise<Tree> {
    return await this.treeStore.getTree(treeId);
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
  private kbStoragePath: string;

  constructor(basePath: string, kbStoragePath?: string) {
    this.basePath = resolve(basePath);
    // Default KB storage path is basePath/knowledge-bases
    this.kbStoragePath = kbStoragePath
      ? resolve(kbStoragePath)
      : resolve(basePath, 'knowledge-bases');
  }

  /**
   * Get the KB storage path
   */
  getKbStoragePath(): string {
    return this.kbStoragePath;
  }

  /**
   * Ensure the KB storage directory exists
   */
  async ensureStorageDir(): Promise<void> {
    if (!existsSync(this.kbStoragePath)) {
      await mkdir(this.kbStoragePath, { recursive: true });
      console.log(`📁 Created KB storage directory: ${this.kbStoragePath}`);
    }
  }

  /**
   * Discover all knowledge bases in the storage path
   * Returns info about each KB, including whether it's currently loaded
   */
  async discover(): Promise<DiscoveredKB[]> {
    await this.ensureStorageDir();

    const discovered: DiscoveredKB[] = [];

    try {
      const entries = await readdir(this.kbStoragePath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const kbPath = join(this.kbStoragePath, entry.name);
        const configPath = join(kbPath, 'kb.json');

        if (!existsSync(configPath)) continue;

        try {
          const configContent = await readFile(configPath, 'utf-8');
          const config: KnowledgeBaseConfig = JSON.parse(configContent);

          discovered.push({
            id: config.id,
            name: config.name,
            path: kbPath,
            folderName: entry.name,
            organizingPrinciple: config.organizingPrinciple,
            isLoaded: this.knowledgeBases.has(config.id),
          });
        } catch (err: any) {
          console.warn(`⚠️ Invalid KB at ${kbPath}: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.warn(`⚠️ Failed to scan KB storage: ${err.message}`);
    }

    return discovered;
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
   * Load a KB by its path
   */
  async load(kbPath: string): Promise<KnowledgeBase> {
    const absolutePath = resolve(kbPath);
    const kb = await KnowledgeBase.load(absolutePath);
    this.knowledgeBases.set(kb.id, kb);
    console.log(`📚 Loaded KB: ${kb.name} (${kb.id})`);
    return kb;
  }

  /**
   * Create a new KB in the storage path with a simple name
   * Auto-generates the folder name and ID from the name
   */
  async createInStorage(options: {
    name: string;
    organizingPrinciple: string;
    seedFolders?: SeedFolder[];
    dogma?: KnowledgeBaseConfig['dogma'];
  }): Promise<KnowledgeBase> {
    await this.ensureStorageDir();

    // Generate folder name from name (lowercase, replace spaces with dashes, remove special chars)
    const folderName = options.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);

    // Generate unique ID
    const id = `kb-${folderName}-${Date.now().toString(36)}`;

    // Full path in storage
    const kbPath = join(this.kbStoragePath, folderName);

    // Check if folder already exists, append number if needed
    let finalPath = kbPath;
    let counter = 1;
    while (existsSync(finalPath)) {
      finalPath = `${kbPath}-${counter}`;
      counter++;
    }

    const kb = await KnowledgeBase.create(finalPath, {
      id,
      name: options.name,
      organizingPrinciple: options.organizingPrinciple,
      seedFolders: options.seedFolders,
      dogma: options.dogma,
    });

    this.knowledgeBases.set(kb.id, kb);
    return kb;
  }

  /**
   * Create a new KB and add it to the manager (legacy method with explicit path)
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
