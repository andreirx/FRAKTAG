// src/index.ts

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { ContentStore } from './core/ContentStore.js';
import { TreeStore } from './core/TreeStore.js';
import { Fractalizer } from './core/Fractalizer.js';
import { Navigator } from './core/Navigator.js';
import { JsonStorage } from './adapters/storage/JsonStorage.js';
import { ILLMAdapter } from './adapters/llm/ILLMAdapter.js';
import { OllamaAdapter } from './adapters/llm/OllamaAdapter.js';
import {OpenAIAdapter} from "./adapters/llm/OpenAIAdapter.js";
import { DEFAULT_PROMPTS } from './prompts/default.js';
import {
  FraktagConfig,
  IngestRequest,
  IngestResult,
  RetrieveRequest,
  RetrieveResult,
  BrowseRequest,
  BrowseResult,
  ContentAtom,
  Tree,
  TreeNode,
  VerificationResult,
} from './core/types.js';

/**
 * Fraktag Engine - Multi-resolution knowledge management
 */
export class Fraktag {
  private config: FraktagConfig;
  private storage: JsonStorage;
  private contentStore: ContentStore;
  private treeStore: TreeStore;
  private fractalizer: Fractalizer;
  private navigator: Navigator;
  private llm: ILLMAdapter;

  private constructor(config: FraktagConfig, storage: JsonStorage) {
    this.config = config;
    this.storage = storage;

    // Initialize LLM adapter
    this.llm = this.createLLMAdapter(config.llm);

    // Initialize stores
    this.contentStore = new ContentStore(storage);
    this.treeStore = new TreeStore(storage);

    // Merge custom prompts with defaults
    const prompts = {
      ...DEFAULT_PROMPTS,
      ...config.llm.prompts,
    };

    // Initialize engines
    this.fractalizer = new Fractalizer(
      this.contentStore,
      this.treeStore,
      this.llm,
      config.ingestion,
      prompts
    );

    this.navigator = new Navigator(
      this.contentStore,
      this.treeStore,
      this.llm
    );
  }

  /**
   * Initialize Fraktag from a config file
   */
  static async fromConfigFile(configPath: string): Promise<Fraktag> {
    try {
      const absolutePath = resolve(configPath);
      const configContent = await readFile(absolutePath, 'utf-8');
      const config: FraktagConfig = JSON.parse(configContent);

      // Resolve storage path relative to config file location
      const storagePath = resolve(absolutePath, '..', config.storagePath);
      const storage = new JsonStorage(storagePath);

      // Ensure storage directories exist
      await storage.ensureDir('content');
      await storage.ensureDir('trees');

      const instance = new Fraktag(config, storage);

      // Initialize trees if they don't exist
      await instance.initializeTrees();

      return instance;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse config file: ${error.message}`);
      }
      throw new Error(`Failed to load config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Initialize Fraktag with direct config
   */
  static async fromConfig(config: FraktagConfig): Promise<Fraktag> {
    const storage = new JsonStorage(config.storagePath);
    await storage.ensureDir('content');
    await storage.ensureDir('trees');

    const instance = new Fraktag(config, storage);
    await instance.initializeTrees();

    return instance;
  }

  // ============ INGESTION ============

  /**
   * Ingest raw content
   */
  async ingest(request: IngestRequest): Promise<IngestResult> {
    const targetTrees = request.targetTrees && request.targetTrees.length > 0
      ? request.targetTrees
      : this.config.trees.filter(t => t.autoPlace).map(t => t.id);

    if (targetTrees.length === 0) {
      throw new Error('No target trees specified and no autoPlace trees configured');
    }

    const placements: IngestResult['placements'] = [];
    let contentId = '';

    for (const treeId of targetTrees) {
      const tree = await this.treeStore.getTree(treeId);

      if (request.parentNodeId) {
        // Explicit placement
        const node = await this.fractalizer.ingest(
          request.content,
          treeId,
          request.parentNodeId,
          '',
          0
        );
        contentId = node.contentId ?? '';
        placements.push({
          treeId,
          nodeId: node.id,
          path: node.path,
        });
      } else {
        // Auto-placement: let fractalizer intelligently place content
        const node = await this.fractalizer.ingest(
          request.content,
          treeId,
          null, // Triggers auto-placement logic
          '',
          0
        );

        contentId = node.contentId ?? '';
        placements.push({
          treeId,
          nodeId: node.id,
          path: node.path,
        });
      }
    }

    return { contentId, placements };
  }

  /**
   * Ingest from URL
   */
  async ingestUrl(url: string, options?: Partial<IngestRequest>): Promise<IngestResult> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.statusText}`);
      }

      const content = await response.text();

      return await this.ingest({
        content,
        sourceUri: url,
        mediaType: response.headers.get('content-type') ?? 'text/plain',
        ...options,
      });
    } catch (error) {
      throw new Error(`Failed to ingest URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upsert content (Update if exists, Insert if new)
   * Ideal for syncing from external sources like Apple Notes
   * @param request - Standard ingest request with externalId for tracking
   * @returns IngestResult with placement information
   */
  async upsert(request: IngestRequest & { externalId: string }): Promise<IngestResult> {
    // Use sourceUri as the primary tracking key
    const uri = request.sourceUri || `external:${request.externalId}`;
    console.log(`📦 [Upsert] Processing: ${uri}`);

    // Look for existing content with this sourceUri
    const allContentIds = await this.contentStore.listIds();
    let existingAtom: ContentAtom | null = null;

    for (const id of allContentIds) {
      const atom = await this.contentStore.get(id);
      if (atom && atom.sourceUri === uri) {
        existingAtom = atom;
        break;
      }
    }

    if (existingAtom) {
      // Check if content has changed
      const newHash = this.contentStore.calculateHash(request.content);

      if (existingAtom.hash === newHash) {
        // No change - return existing placements
        const nodes = await this.treeStore.findNodesByContent(existingAtom.id);
        return {
          contentId: existingAtom.id,
          placements: nodes.map(n => ({ treeId: n.treeId, nodeId: n.id, path: n.path })),
        };
      }

      // Content has changed - create new version
      const newAtom = await this.contentStore.create({
        payload: request.content,
        mediaType: request.mediaType || existingAtom.mediaType,
        sourceUri: uri,
        createdBy: existingAtom.createdBy,
        supersedes: existingAtom.id,
        metadata: { ...existingAtom.metadata, ...request.metadata },
      });

      // Update all tree nodes that reference this content
      const nodes = await this.treeStore.findNodesByContent(existingAtom.id);
      const placements: IngestResult['placements'] = [];

      for (const node of nodes) {
        // Update content reference
        node.contentId = newAtom.id;
        node.updatedAt = new Date().toISOString();

        // Regenerate gist with new content
        const tree = await this.treeStore.getTree(node.treeId);
        try {
          const newGist = await this.llm.complete(
            DEFAULT_PROMPTS.generateGist,
            { content: request.content, organizingPrinciple: tree.organizingPrinciple }
          );
          node.l0Gist = newGist;
        } catch (error) {
          console.error('Failed to regenerate gist:', error);
        }

        await this.treeStore.saveNode(node);

        // Bubble up changes to ancestors
        try {
          await this.fractalizer.regenerateSummaries(node.id);
        } catch (error) {
          console.error('Failed to regenerate summaries:', error);
        }

        placements.push({
          treeId: node.treeId,
          nodeId: node.id,
          path: node.path,
        });
      }

      return { contentId: newAtom.id, placements };
    }

    console.log(`   ➔ New content detected. Triggering Ingest...`);
    // New content - use standard ingest with sourceUri
    return this.ingest({ ...request, sourceUri: uri });
  }

  // ============ RETRIEVAL ============

  /**
   * Query-driven retrieval
   */
  async retrieve(request: RetrieveRequest): Promise<RetrieveResult> {
    return await this.navigator.retrieve(request);
  }

  /**
   * Manual browsing
   */
  async browse(request: BrowseRequest): Promise<BrowseResult> {
    return await this.navigator.browse(request);
  }

  /**
   * Direct content fetch
   */
  async getContent(contentId: string): Promise<ContentAtom | null> {
    return await this.contentStore.get(contentId);
  }

  // ============ TREE MANAGEMENT ============

  /**
   * List all trees
   */
  async listTrees(): Promise<Tree[]> {
    return await this.treeStore.listTrees();
  }

  /**
   * Create organizational node
   */
  async createNode(treeId: string, parentId: string | null, name: string): Promise<TreeNode> {
    const tree = await this.treeStore.getTree(treeId);
    const parent = parentId ? await this.treeStore.getNode(parentId) : null;

    const nodeId = name.toLowerCase().replace(/\s+/g, '-');
    const path = parent ? `${parent.path}${nodeId}/` : `/${nodeId}`;

    const node: TreeNode = {
      id: nodeId,
      treeId,
      parentId,
      path,
      contentId: null,
      l0Gist: name,
      l1Map: null,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.treeStore.saveNode(node);

    if (parentId) {
      await this.fractalizer.regenerateSummaries(parentId);
    }

    return node;
  }

  /**
   * Move node to different parent
   */
  async moveNode(nodeId: string, newParentId: string): Promise<TreeNode> {
    const node = await this.treeStore.moveNode(nodeId, newParentId);

    // Regenerate summaries for both old and new parents
    if (node.parentId) {
      await this.fractalizer.regenerateSummaries(node.parentId);
    }

    return node;
  }

  /**
   * Link existing content to additional tree
   */
  async placeContent(contentId: string, treeId: string, parentNodeId: string): Promise<TreeNode> {
    const content = await this.contentStore.get(contentId);
    if (!content) {
      throw new Error(`Content not found: ${contentId}`);
    }

    const tree = await this.treeStore.getTree(treeId);
    const gist = await this.llm.complete(
      DEFAULT_PROMPTS.generateGist,
      { content: content.payload, organizingPrinciple: tree.organizingPrinciple }
    );

    return await this.fractalizer.autoPlace(contentId, gist, treeId);
  }

  // ============ MAINTENANCE ============

  /**
   * Regenerate L0/L1 for node and ancestors
   */
  async regenerateSummaries(nodeId: string): Promise<void> {
    await this.fractalizer.regenerateSummaries(nodeId);
  }

  /**
   * Verify tree integrity
   */
  async verifyTree(treeId: string): Promise<VerificationResult> {
    const result: VerificationResult = {
      valid: true,
      orphanNodes: [],
      missingContentRefs: [],
      errors: [],
    };

    try {
      const tree = await this.treeStore.getTree(treeId);
      const allNodes = await this.treeStore.getAllNodes(treeId);

      // Check for orphan nodes (nodes with invalid parent references)
      for (const node of allNodes) {
        if (node.id === tree.rootNodeId) continue;

        if (node.parentId) {
          const parent = await this.treeStore.getNode(node.parentId);
          if (!parent) {
            result.orphanNodes.push(node.id);
            result.valid = false;
          }
        }

        // Check for missing content references
        if (node.contentId) {
          const content = await this.contentStore.get(node.contentId);
          if (!content) {
            result.missingContentRefs.push(node.id);
            result.valid = false;
          }
        }
      }
    } catch (error) {
      result.valid = false;
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    return result;
  }

  // ============ PRIVATE METHODS ============

  /**
   * Initialize trees from config
   */
  private async initializeTrees(): Promise<void> {
    const existingTrees = await this.treeStore.listTrees();
    const existingTreeIds = new Set(existingTrees.map(t => t.id));

    for (const treeConfig of this.config.trees) {
      if (!existingTreeIds.has(treeConfig.id)) {
        await this.treeStore.createTree(treeConfig);
      }
    }
  }

  /**
   * Create LLM adapter based on config
   */
  private createLLMAdapter(config: FraktagConfig['llm']): ILLMAdapter {
    switch (config.adapter) {
      case 'ollama':
        return new OllamaAdapter({
          endpoint: config.endpoint ?? 'http://localhost:11434',
          model: config.model,
        });
      case 'openai':
        if (!config.apiKey) {
          throw new Error('OpenAI adapter requires an apiKey in config');
        }
        return new OpenAIAdapter({
          apiKey: config.apiKey,
          model: config.model,
          endpoint: config.endpoint // Optional override
        });
      case 'anthropic':
        throw new Error('Anthropic adapter not yet implemented');
      default:
        throw new Error(`Unknown LLM adapter: ${config.adapter}`);
    }
  }
}

// Export all types
export * from './core/types.js';
