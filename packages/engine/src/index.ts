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
import { OpenAIAdapter } from "./adapters/llm/OpenAIAdapter.js";
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
  VerificationResult, EmbeddingConfig,
} from './core/types.js';
import { IEmbeddingAdapter } from './adapters/embeddings/IEmbeddingAdapter.js';
import { OllamaEmbeddingAdapter } from './adapters/embeddings/OllamaEmbeddingAdapter.js';
import { OpenAIEmbeddingAdapter } from './adapters/embeddings/OpenAIEmbeddingAdapter.js';
import { VectorStore } from './core/VectorStore.js';


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
  private embedder: IEmbeddingAdapter;
  private vectorStore: VectorStore;
  private basicLlm: ILLMAdapter;
  private smartLlm: ILLMAdapter;

  private constructor(config: FraktagConfig, storage: JsonStorage) {
    this.config = config;
    this.storage = storage;

    // 1. Initialize Smart LLM (The Brain)
    this.smartLlm = this.createLLMAdapter(config.llm);

    // 2. Initialize Basic LLM (The Worker)
    if (config.llm.basicModel) {
      // Clone config but swap model
      const basicConfig = { ...config.llm, model: config.llm.basicModel };
      this.basicLlm = this.createLLMAdapter(basicConfig);
    } else {
      this.basicLlm = this.smartLlm; // Fallback
    }

    // Initialize stores
    this.contentStore = new ContentStore(storage);
    this.treeStore = new TreeStore(storage);

    this.embedder = this.createEmbeddingAdapter(config.embedding);
    this.vectorStore = new VectorStore(storage, this.embedder);

    // Merge custom prompts with defaults
    const prompts = {
      ...DEFAULT_PROMPTS,
      ...config.llm.prompts,
    };

    // Initialize engines
    this.fractalizer = new Fractalizer(
      this.contentStore,
      this.treeStore,
      this.vectorStore,
      this.basicLlm, // <--- Use Basic for fast tasks
      this.smartLlm, // <--- Use Smart for hard tasks
      config.ingestion,
      prompts
    );

    this.navigator = new Navigator(
      this.contentStore,
      this.treeStore,
      this.vectorStore,
      this.basicLlm // <--- Navigator uses Basic for speed
    );
  }

  private createEmbeddingAdapter(config?: EmbeddingConfig): IEmbeddingAdapter {
    if (!config || config.adapter === 'ollama') {
      return new OllamaEmbeddingAdapter(
          config?.endpoint,
          config?.model || 'nomic-embed-text'
      );
    }
    if (config.adapter === 'openai') {
      if (!config.apiKey) throw new Error("OpenAI embedding requires apiKey");
      return new OpenAIEmbeddingAdapter(config.apiKey, config.model);
    }
    throw new Error(`Unknown embedding adapter: ${config.adapter}`);
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
      const newHash = this.contentStore.calculateHash(request.content);

      if (existingAtom.hash === newHash) {
        console.log(`   ⏭️  Content unchanged. Skipping.`);
        // Return existing placement
        const nodes = await this.treeStore.findNodesByContent(existingAtom.id);
        return {
          contentId: existingAtom.id,
          placements: nodes.map(n => ({ treeId: n.treeId, nodeId: n.id, path: n.path })),
        };
      }

      console.log(`   🔄 Content changed! Creating Version ${new Date().toISOString()}`);

      // 1. Create New Atom (Versioned)
      const newAtom = await this.contentStore.create({
        payload: request.content,
        mediaType: request.mediaType || existingAtom.mediaType,
        sourceUri: uri,
        createdBy: existingAtom.createdBy,
        supersedes: existingAtom.id, // Linked list of history
        metadata: { ...existingAtom.metadata, ...request.metadata },
      });

      // 2. Find all nodes using the OLD content
      const nodes = await this.treeStore.findNodesByContent(existingAtom.id);
      const placements: IngestResult['placements'] = [];

      // 3. Mutate the Nodes (In-Place Update)
      for (const node of nodes) {
        // Use the Fractalizer to handle the heavy lifting (Gist regen, Vector update, Bubble Up)
        await this.fractalizer.updateNode(node.id, newAtom.id, request.content);

        placements.push({
          treeId: node.treeId,
          nodeId: node.id,
          path: node.path
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
    const gist = await this.basicLlm.complete(
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
        const apiKey = config.apiKey || process.env.FRAKTAG_OPENAI_KEY || process.env.OPENAI_API_KEY;
        if (!apiKey) {
          throw new Error('OpenAI adapter requires apiKey (config or FRAKTAG_OPENAI_KEY env var)');
        }
        return new OpenAIAdapter({ ...config, apiKey });
      case 'anthropic':
        throw new Error('Anthropic adapter not yet implemented');
      default:
        throw new Error(`Unknown LLM adapter: ${config.adapter}`);
    }
  }

  /**
   * ASK: The Synthesis Layer (RAG/KAG)
   * Combines Retrieval with Generation to answer a user question.
   */
  async ask(query: string, treeId: string = 'notes'): Promise<{ answer: string; references: string[] }> {
    console.log(`\n🧠 [Synthesis] Asking: "${query}"`);

    // 1. RETRIEVE (The Explorer)
    const retrieval = await this.retrieve({
      query,
      treeId,
      maxDepth: 5,
      resolution: 'L2' // High fidelity content needed for answers
    });

    if (retrieval.nodes.length === 0) {
      return {
        answer: "I explored the knowledge tree but found no relevant information to answer your question.",
        references: []
      };
    }

    // 2. CONTEXT PREPARATION
    const contextPromises = retrieval.nodes.map(async (node, i) => {
      // Fetch the Tree Node to get its Gist/Name
      const treeNode = await this.treeStore.getNode(node.nodeId);
      const title = treeNode?.l0Gist || "Untitled Segment";

      // Also fetch metadata from Content Atom if possible?
      // Actually, node.contentId is on the RetrievedNode.
      let sourceInfo = "";
      if (node.contentId) {
        const atom = await this.contentStore.get(node.contentId);
        if (atom?.sourceUri) {
          const filename = atom.sourceUri.split('/').pop();
          sourceInfo = `(File: ${filename})`;
        }
      }

      // PRINT TO CONSOLE (The "First Glance" for the user)
      console.log(`   📄 [${i+1}] ${title.slice(0, 80)}${title.length > 80 ? '...' : ''} ${sourceInfo}`);

      return `--- [SOURCE ${i+1}] Title: "${title}" ${sourceInfo} ---\n${node.content}`;
    });

    const contextBlocks = await Promise.all(contextPromises);
    const context = contextBlocks.join('\n\n');

    const prompt = `You are the Oracle. Answer the user's question using ONLY the provided context.
    
    Guidelines:
    - Cite your sources using the source as [number], AND also mention the Title for example "according to the Reference Manual [1]".
    - Use the Titles provided in the context to explain where information comes from.
    - If the context mentions specific terms, define them as the text does.
    - Do not use outside knowledge. If the answer isn't in the text, say so.
    
    Context:
    ${context}
    
    Question: ${query}
    
    Answer:`;

    // 3. GENERATION
    console.log(`   📝 Synthesizing answer from ${retrieval.nodes.length} sources...`);

    const answer = await this.smartLlm.complete(
        prompt,
        {},
        { maxTokens: 8192 } // Generous limit for the final answer
    );

    return {
      answer,
      references: retrieval.nodes.map(n => n.path)
    };
  }
}

// Export all types
export * from './core/types.js';
