// src/index.ts
// FRAKTAG ENGINE - Strict Taxonomy Edition

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
  FolderNode,
  DocumentNode,
  VerificationResult,
  EmbeddingConfig,
  SplitAnalysis,
  isFolder,
  hasContent
} from './core/types.js';
import { IEmbeddingAdapter } from './adapters/embeddings/IEmbeddingAdapter.js';
import { OllamaEmbeddingAdapter } from './adapters/embeddings/OllamaEmbeddingAdapter.js';
import { OpenAIEmbeddingAdapter } from './adapters/embeddings/OpenAIEmbeddingAdapter.js';
import { VectorStore } from './core/VectorStore.js';
import { Arborist, TreeOperation } from './core/Arborist.js';

/**
 * Fraktag Engine - Strict Taxonomy Knowledge Management
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
  private arborist: Arborist;

  private basicLlm: ILLMAdapter;
  private smartLlm: ILLMAdapter;
  private expertLlm: ILLMAdapter;

  private constructor(config: FraktagConfig, storage: JsonStorage) {
    this.config = config;
    this.storage = storage;

    // Initialize LLM adapters
    this.smartLlm = this.createLLMAdapter(config.llm);

    if (config.llm.basicModel) {
      const basicConfig = { ...config.llm, model: config.llm.basicModel };
      this.basicLlm = this.createLLMAdapter(basicConfig);
    } else {
      this.basicLlm = this.smartLlm;
    }

    if (config.llm.expertModel) {
      const expertConfig = { ...config.llm, model: config.llm.expertModel };
      this.expertLlm = this.createLLMAdapter(expertConfig);
    } else {
      this.expertLlm = this.smartLlm;
    }

    // Initialize stores
    this.contentStore = new ContentStore(storage);
    this.treeStore = new TreeStore(storage);

    this.embedder = this.createEmbeddingAdapter(config.embedding);
    this.vectorStore = new VectorStore(storage, this.embedder);

    this.arborist = new Arborist(this.treeStore, this.vectorStore);

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
      this.basicLlm,
      this.smartLlm,
      config.ingestion,
      prompts
    );

    this.navigator = new Navigator(
      this.contentStore,
      this.treeStore,
      this.vectorStore,
      this.basicLlm
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

  // ============ FACTORY METHODS ============

  static async fromConfigFile(configPath: string): Promise<Fraktag> {
    try {
      const absolutePath = resolve(configPath);
      const configContent = await readFile(absolutePath, 'utf-8');
      const config: FraktagConfig = JSON.parse(configContent);

      const storagePath = resolve(absolutePath, '..', config.storagePath);
      const storage = new JsonStorage(storagePath);

      await storage.ensureDir('content');
      await storage.ensureDir('trees');
      await storage.ensureDir('indexes');

      const instance = new Fraktag(config, storage);
      await instance.initializeTrees();

      return instance;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse config file: ${error.message}`);
      }
      throw new Error(`Failed to load config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async fromConfig(config: FraktagConfig): Promise<Fraktag> {
    const storage = new JsonStorage(config.storagePath);
    await storage.ensureDir('content');
    await storage.ensureDir('trees');
    await storage.ensureDir('indexes');

    const instance = new Fraktag(config, storage);
    await instance.initializeTrees();

    return instance;
  }

  // ============ TREE MANAGEMENT ============

  async listTrees(): Promise<Tree[]> {
    return await this.treeStore.listTrees();
  }

  async getTree(treeId: string): Promise<Tree> {
    return await this.treeStore.getTree(treeId);
  }

  async getFullTree(treeId: string): Promise<{ config: any, nodes: Record<string, any> }> {
    return await this.treeStore.getTreeFile(treeId);
  }

  async printTree(treeId: string): Promise<string> {
    return await this.treeStore.generateVisualTree(treeId);
  }

  async getLeafFolders(treeId: string): Promise<FolderNode[]> {
    return await this.treeStore.getLeafFolders(treeId);
  }

  // ============ FOLDER MANAGEMENT ============

  async createFolder(treeId: string, parentId: string, title: string, gist: string): Promise<FolderNode> {
    return await this.treeStore.createFolder(treeId, parentId, title, gist);
  }

  // ============ INGESTION (Human-Assisted Workflow) ============

  /**
   * PHASE 1: Analyze content for splitting (programmatic, no AI)
   */
  analyzeSplits(content: string, sourceUri: string): SplitAnalysis {
    return this.fractalizer.analyzeSplits(content, sourceUri);
  }

  /**
   * PHASE 2: Ingest a document into a specific folder
   */
  async ingestDocument(
    content: string,
    treeId: string,
    parentFolderId: string,
    title: string,
    gist?: string
  ): Promise<DocumentNode> {
    return await this.fractalizer.ingestDocument(content, treeId, parentFolderId, title, gist);
  }

  /**
   * PHASE 3: Create fragments under a document
   */
  async createFragment(
    content: string,
    treeId: string,
    parentDocumentId: string,
    title: string,
    gist?: string
  ) {
    return await this.fractalizer.createFragment(content, treeId, parentDocumentId, title, gist);
  }

  /**
   * Generate a gist for content
   */
  async generateGist(content: string, treeId: string): Promise<string> {
    return await this.fractalizer.generateGist(content, treeId);
  }

  /**
   * Generate a title for content
   */
  async generateTitle(content: string, treeId: string): Promise<string> {
    return await this.fractalizer.generateTitle(content, treeId);
  }

  /**
   * AI-assisted split generation
   */
  async generateAiSplits(content: string, treeId: string): Promise<{ title: string; text: string }[]> {
    return await this.fractalizer.generateAiSplits(content, treeId);
  }

  /**
   * Propose placement for a document in the tree
   */
  async proposePlacement(treeId: string, documentTitle: string, documentGist: string): Promise<{
    folderId: string;
    reasoning: string;
    confidence: number;
  }> {
    return await this.fractalizer.proposePlacement(treeId, documentTitle, documentGist);
  }

  // ============ LEGACY INGESTION (Deprecated) ============

  /**
   * @deprecated Use ingestDocument with explicit folder placement
   */
  async ingest(request: IngestRequest): Promise<IngestResult> {
    console.warn('Fraktag.ingest() is deprecated. Use ingestDocument() with explicit placement.');

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

      // Find a leaf folder to place content
      const leafFolders = await this.treeStore.getLeafFolders(treeId);
      const targetFolder = request.parentNodeId || (leafFolders.length > 0 ? leafFolders[0].id : tree.rootNodeId);

      const title = await this.fractalizer.generateTitle(request.content, treeId);
      const node = await this.fractalizer.ingestDocument(request.content, treeId, targetFolder, title);

      contentId = node.contentId;
      placements.push({
        treeId,
        nodeId: node.id,
        path: node.path,
      });
    }

    return { contentId, placements };
  }

  /**
   * @deprecated Use ingestDocument with upsert logic in application layer
   */
  async upsert(request: IngestRequest & { externalId: string }): Promise<IngestResult> {
    console.warn('Fraktag.upsert() is deprecated.');
    return await this.ingest(request);
  }

  // ============ RETRIEVAL ============

  async retrieve(request: RetrieveRequest): Promise<RetrieveResult> {
    return await this.navigator.retrieve(request);
  }

  async browse(request: BrowseRequest): Promise<BrowseResult> {
    return await this.navigator.browse(request);
  }

  async getContent(contentId: string): Promise<ContentAtom | null> {
    return await this.contentStore.get(contentId);
  }

  // ============ NODE OPERATIONS ============

  /**
   * Update node title and/or gist
   */
  async updateNode(nodeId: string, updates: { title?: string; gist?: string }): Promise<TreeNode> {
    const node = await this.treeStore.getNode(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    if (updates.title !== undefined) {
      node.title = updates.title;
    }
    if (updates.gist !== undefined) {
      node.gist = updates.gist;
    }
    node.updatedAt = new Date().toISOString();

    await this.treeStore.saveNode(node);

    // Update vector index with new title/gist
    await this.vectorStore.remove(nodeId);
    let indexText = `${node.title}\n${node.gist}`;
    if (hasContent(node)) {
      const content = await this.contentStore.get(node.contentId);
      if (content) {
        indexText += `\n${content.payload.slice(0, 500)}`;
      }
    }
    await this.vectorStore.add(nodeId, indexText);
    await this.vectorStore.save(node.treeId);

    return node;
  }

  // ============ ASK (RAG/KAG Synthesis) ============

  async ask(query: string, treeId: string = 'notes'): Promise<{ answer: string; references: string[] }> {
    console.log(`\n🧠 [Synthesis] Asking: "${query}"`);

    const retrieval = await this.retrieve({
      query,
      treeId,
      maxDepth: 5,
      resolution: 'L2'
    });

    if (retrieval.nodes.length === 0) {
      return {
        answer: "I explored the knowledge tree but found no relevant information to answer your question.",
        references: []
      };
    }

    const contextPromises = retrieval.nodes.map(async (node, i) => {
      const treeNode = await this.treeStore.getNode(node.nodeId);
      const title = treeNode?.title || "Untitled Segment";

      let sourceInfo = "";
      if (node.contentId) {
        const atom = await this.contentStore.get(node.contentId);
        if (atom?.sourceUri) {
          const filename = atom.sourceUri.split('/').pop();
          sourceInfo = `(File: ${filename})`;
        }
      }

      console.log(`   📄 [${i+1}] ${title.slice(0, 160)}${title.length > 160 ? '...' : ''} ${sourceInfo}`);

      return `--- [SOURCE ${i+1}] Title: "${title}" ${sourceInfo} ---\n${node.content}`;
    });

    const contextBlocks = await Promise.all(contextPromises);
    const context = contextBlocks.join('\n\n');

    const prompt = `You are the Oracle. Answer the user's question using ONLY the provided context.

    Guidelines:
    - Cite your sources using the source as [number], AND also mention the Title for example "according to ... [1]".
    - Use the Titles provided in the context to explain where information comes from.
    - If the context mentions specific terms, define them as the text does.
    - Do not use outside knowledge. If the answer isn't in the text, say so.

    Context:
    ${context}

    Question: ${query}

    Answer:`;

    console.log(`   📝 Synthesizing answer from ${retrieval.nodes.length} sources...`);

    const answer = await this.smartLlm.complete(prompt, {});

    return {
      answer,
      references: retrieval.nodes.map(n => n.path)
    };
  }

  // ============ MAINTENANCE ============

  async verifyTree(treeId: string): Promise<VerificationResult> {
    const result: VerificationResult = {
      valid: true,
      orphanNodes: [],
      missingContentRefs: [],
      constraintViolations: [],
      errors: [],
    };

    try {
      const tree = await this.treeStore.getTree(treeId);
      const allNodes = await this.treeStore.getAllNodes(treeId);

      for (const node of allNodes) {
        if (node.id === tree.rootNodeId) continue;

        // Check orphan nodes
        if (node.parentId) {
          const parent = await this.treeStore.getNode(node.parentId);
          if (!parent) {
            result.orphanNodes.push(node.id);
            result.valid = false;
          }
        }

        // Check missing content refs
        if (hasContent(node)) {
          const content = await this.contentStore.get(node.contentId);
          if (!content) {
            result.missingContentRefs.push(node.id);
            result.valid = false;
          }
        }

        // Check constraint violations
        if (node.parentId) {
          const parent = await this.treeStore.getNode(node.parentId);
          if (parent) {
            // Folder with both folder and document children
            if (isFolder(parent)) {
              const siblings = await this.treeStore.getChildren(node.parentId);
              const hasFolders = siblings.some(s => isFolder(s));
              const hasDocuments = siblings.some(s => s.type === 'document');
              if (hasFolders && hasDocuments) {
                result.constraintViolations.push(
                  `Folder "${parent.title}" contains both folders and documents`
                );
                result.valid = false;
              }
            }
          }
        }
      }
    } catch (error) {
      result.valid = false;
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    return result;
  }

  async audit(treeId: string): Promise<any> {
    console.log(`\n🕵️  The Gardener (Expert) is inspecting tree: ${treeId}...`);

    const treeMap = await this.treeStore.generateTreeMap(treeId);
    const treeConfig = await this.treeStore.getTree(treeId);

    const dogma = (treeConfig as any).dogma
      ? JSON.stringify((treeConfig as any).dogma)
      : "None";

    const resultJson = await this.expertLlm.complete(
      DEFAULT_PROMPTS.analyzeTreeStructure,
      {
        treeMap,
        organizingPrinciple: treeConfig.organizingPrinciple,
        dogma
      }
    );

    try {
      return JSON.parse(resultJson);
    } catch (e) {
      console.error("Gardener returned invalid JSON", e);
      return { issues: [], raw: resultJson };
    }
  }

  async applyFix(treeId: string, operation: TreeOperation): Promise<string> {
    return await this.arborist.execute(treeId, operation);
  }

  async reset(treeId: string, options: { pruneContent?: boolean } = {}): Promise<void> {
    const treeConfig = this.config.trees.find(t => t.id === treeId);
    if (!treeConfig) throw new Error(`Tree ${treeId} not configured.`);

    console.log(`🔥 Resetting Tree: ${treeId}`);

    await this.treeStore.deleteTree(treeId);
    await this.vectorStore.deleteIndex(treeId);
    await this.treeStore.createTree(treeConfig);

    if (options.pruneContent) {
      console.log(`   🧹 Pruning derived chunks...`);
      const count = await this.contentStore.pruneDerived();
      console.log(`   ✅ Removed ${count} generated fragments.`);
    }

    console.log(`✅ Tree ${treeId} reset to factory settings.`);
  }

  clearCache(treeId?: string) {
    this.treeStore.clearCache(treeId);
  }

  // ============ PRIVATE METHODS ============

  private async initializeTrees(): Promise<void> {
    const existingTrees = await this.treeStore.listTrees();
    const existingTreeIds = new Set(existingTrees.map(t => t.id));

    for (const treeConfig of this.config.trees) {
      if (!existingTreeIds.has(treeConfig.id)) {
        await this.treeStore.createTree(treeConfig);
        console.log(`🌱 Created tree: ${treeConfig.name}`);
      }
    }
  }

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
}

// Export all types
export * from './core/types.js';
