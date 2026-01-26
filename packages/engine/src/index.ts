// src/index.ts
// FRAKTAG ENGINE - Strict Taxonomy Edition

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
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
  ContentEditMode,
  Tree,
  TreeNode,
  FolderNode,
  DocumentNode,
  VerificationResult,
  EmbeddingConfig,
  SplitAnalysis,
  KnowledgeBaseConfig,
  isFolder,
  hasContent
} from './core/types.js';
import { IEmbeddingAdapter } from './adapters/embeddings/IEmbeddingAdapter.js';
import { OllamaEmbeddingAdapter } from './adapters/embeddings/OllamaEmbeddingAdapter.js';
import { OpenAIEmbeddingAdapter } from './adapters/embeddings/OpenAIEmbeddingAdapter.js';
import { VectorStore } from './core/VectorStore.js';
import { Arborist, TreeOperation } from './core/Arborist.js';
import { FileProcessor } from './utils/FileProcessor.js';
import { KnowledgeBase, KnowledgeBaseManager, DiscoveredKB } from './core/KnowledgeBase.js';
import { ConversationManager, TurnData, ConversationSession, ConversationTurn, ConversationReference } from './core/ConversationManager.js';

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
  private fileProcessor: FileProcessor;
  private vectorStore: VectorStore;
  private arborist: Arborist;

  private basicLlm: ILLMAdapter;
  private smartLlm: ILLMAdapter;
  private expertLlm: ILLMAdapter;

  // Knowledge Base support
  private kbManager?: KnowledgeBaseManager;
  private configPath?: string;
  private kbVectorStores: Map<string, VectorStore> = new Map();

  // Conversation support
  private conversationManager: ConversationManager;

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
    this.fileProcessor = new FileProcessor();
    this.conversationManager = new ConversationManager(this.treeStore, this.contentStore, this.vectorStore);

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

    // Set store resolver on Fractalizer and Navigator for KB-aware operations
    // This allows them to route operations to the correct KB storage
    const storeResolver = {
      getTreeStoreForTree: (treeId: string) => this.getTreeStoreForTree(treeId),
      getContentStoreForTree: (treeId: string) => this.getContentStoreForTree(treeId),
      getVectorStoreForTree: (treeId: string) => this.getVectorStoreForTree(treeId)
    };
    this.fractalizer.setStoreResolver(storeResolver);
    this.navigator.setStoreResolver(storeResolver);
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
      instance.configPath = absolutePath;

      // Initialize KB manager (always, to allow discovery and creation)
      const configDir = dirname(absolutePath);
      const kbStoragePath = config.kbStoragePath
        ? resolve(configDir, config.kbStoragePath)
        : resolve(configDir, 'knowledge-bases');
      instance.kbManager = new KnowledgeBaseManager(configDir, kbStoragePath);

      // Load knowledge bases if configured
      if (config.knowledgeBases && config.knowledgeBases.length > 0) {
        const kbPaths = config.knowledgeBases
          .filter(kb => kb.enabled !== false)
          .map(kb => kb.path);

        await instance.kbManager.loadFromPaths(kbPaths);

        // Initialize trees from loaded KBs
        await instance.initializeKnowledgeBases();
      }

      // Also initialize legacy inline trees
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

  /**
   * List all trees from all sources:
   * - Internal/legacy trees (from main engine storage)
   * - Trees from each loaded knowledge base (from KB storage)
   */
  async listTrees(): Promise<Tree[]> {
    // Get internal/legacy trees from main storage
    const internalTrees = await this.treeStore.listTrees();

    // Get trees from all loaded KBs
    const kbTrees: Tree[] = [];
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        const trees = await kb.listTrees();
        kbTrees.push(...trees);
      }
    }

    return [...internalTrees, ...kbTrees];
  }

  /**
   * List trees for a specific knowledge base.
   * - If kbId is 'internal' or undefined: returns trees from main engine storage
   * - Otherwise: returns trees from the KB's own storage
   */
  async listTreesForKB(kbId?: string): Promise<Tree[]> {
    if (!kbId || kbId === 'internal') {
      // Return internal/legacy trees from main storage
      return await this.treeStore.listTrees();
    }

    // Return trees from the specific KB's storage
    const kb = this.kbManager?.get(kbId);
    if (!kb) {
      return [];
    }
    return await kb.listTrees();
  }

  /**
   * Get a tree by ID. Searches in KB storages first, then main storage.
   */
  async getTree(treeId: string): Promise<Tree> {
    // Try to find in KB storages first (check by kbId prefix)
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        if (treeId.startsWith(kb.id)) {
          try {
            return await kb.treeStore.getTree(treeId);
          } catch {
            // Not found in this KB, continue
          }
        }
      }
    }

    // Fall back to main storage
    return await this.treeStore.getTree(treeId);
  }

  /**
   * Get full tree file (config + nodes). Routes to correct storage.
   */
  async getFullTree(treeId: string): Promise<{ config: any, nodes: Record<string, any> }> {
    // Try to find in KB storages first
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        if (treeId.startsWith(kb.id)) {
          try {
            return await kb.treeStore.getTreeFile(treeId);
          } catch {
            // Not found in this KB, continue
          }
        }
      }
    }

    // Fall back to main storage
    return await this.treeStore.getTreeFile(treeId);
  }

  /**
   * Get the TreeStore for a given tree ID (routes to correct KB or main storage)
   */
  getTreeStoreForTree(treeId: string): TreeStore {
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        if (treeId.startsWith(kb.id)) {
          return kb.treeStore;
        }
      }
    }
    return this.treeStore;
  }

  /**
   * Get the ContentStore for a given tree ID (routes to correct KB or main storage)
   */
  getContentStoreForTree(treeId: string): ContentStore {
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        if (treeId.startsWith(kb.id)) {
          return kb.contentStore;
        }
      }
    }
    return this.contentStore;
  }

  /**
   * Get the VectorStore for a given tree ID (routes to correct KB or main storage).
   * Creates a new VectorStore for each KB on first access (lazy initialization).
   */
  getVectorStoreForTree(treeId: string): VectorStore {
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        if (treeId.startsWith(kb.id)) {
          // Check if we already have a VectorStore for this KB
          if (!this.kbVectorStores.has(kb.id)) {
            // Create a new VectorStore using the KB's storage
            const kbVectorStore = new VectorStore(kb.storage, this.embedder);
            this.kbVectorStores.set(kb.id, kbVectorStore);
          }
          return this.kbVectorStores.get(kb.id)!;
        }
      }
    }
    return this.vectorStore;
  }

  /**
   * Get a node by ID, searching across all storages (main + all KBs).
   */
  async getNode(nodeId: string): Promise<TreeNode | null> {
    // Try main storage first
    let node = await this.treeStore.getNode(nodeId);
    if (node) return node;

    // Try KB storages
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        node = await kb.treeStore.getNode(nodeId);
        if (node) return node;
      }
    }

    return null;
  }

  /**
   * Get the stores (tree + content) for a node's tree
   */
  getStoresForNode(node: TreeNode): { treeStore: TreeStore; contentStore: ContentStore } {
    const treeStore = this.getTreeStoreForTree(node.treeId);
    const contentStore = this.getContentStoreForTree(node.treeId);
    return { treeStore, contentStore };
  }

  async printTree(treeId: string): Promise<string> {
    const store = this.getTreeStoreForTree(treeId);
    return await store.generateVisualTree(treeId);
  }

  async getLeafFolders(treeId: string): Promise<FolderNode[]> {
    const store = this.getTreeStoreForTree(treeId);
    return await store.getLeafFolders(treeId);
  }

  // ============ FOLDER MANAGEMENT ============

  async createFolder(treeId: string, parentId: string, title: string, gist: string): Promise<FolderNode> {
    const store = this.getTreeStoreForTree(treeId);
    return await store.createFolder(treeId, parentId, title, gist);
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
    gist?: string,
    editMode: ContentEditMode = 'readonly'
  ): Promise<DocumentNode> {
    return await this.fractalizer.ingestDocument(content, treeId, parentFolderId, title, gist, editMode);
  }

  /**
   * PHASE 3: Create fragments under a document
   */
  async createFragment(
    content: string,
    treeId: string,
    parentDocumentId: string,
    title: string,
    gist?: string,
    editMode: ContentEditMode = 'readonly'
  ) {
    return await this.fractalizer.createFragment(content, treeId, parentDocumentId, title, gist, editMode);
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

  // ============ EDITABLE CONTENT ============

  /**
   * Create an editable document (user-created note)
   * Content can be edited directly in the UI
   */
  async createEditableDocument(
    treeId: string,
    parentFolderId: string,
    title: string,
    content: string = '',
    gist: string = ''
  ): Promise<DocumentNode> {
    return await this.fractalizer.ingestDocument(
      content,
      treeId,
      parentFolderId,
      title,
      gist || undefined,  // Will skip gist generation if empty
      'editable'
    );
  }

  /**
   * Update the content of an editable document or fragment
   * Returns the updated content atom, or throws if not editable
   * Searches all storages (internal + KBs) for the content
   * Also updates the vector index for the associated node
   */
  async updateEditableContent(contentId: string, newPayload: string, nodeId?: string): Promise<ContentAtom> {
    // Try internal storage first
    let updated = await this.contentStore.updatePayload(contentId, newPayload);
    let foundInKb: KnowledgeBase | null = null;

    if (!updated && this.kbManager) {
      // Try KB storages
      for (const kb of this.kbManager.list()) {
        updated = await kb.contentStore.updatePayload(contentId, newPayload);
        if (updated) {
          foundInKb = kb;
          break;
        }
      }
    }

    if (!updated) {
      throw new Error(`Content not found: ${contentId}`);
    }

    // Update the vector index for the node if we know which node it is
    if (nodeId) {
      const node = await this.getNode(nodeId);
      if (node) {
        const vectorStore = this.getVectorStoreForTree(node.treeId);
        await vectorStore.load(node.treeId);
        await vectorStore.remove(nodeId);
        await vectorStore.add(nodeId, `${node.title}\n${node.gist}\n${newPayload.slice(0, 500)}`);
        await vectorStore.save(node.treeId);
        console.log(`📊 Updated vector index for node ${nodeId}`);
      }
    }

    return updated;
  }

  /**
   * Replace a read-only document's content with a new version
   * This creates a new content atom that supersedes the old one
   * and updates the node to point to the new content
   */
  async replaceContentVersion(
    nodeId: string,
    newContent: string,
    createdBy: string = 'user'
  ): Promise<{ node: TreeNode; newContent: ContentAtom }> {
    // Find the node across all storages
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    if (!hasContent(node)) {
      throw new Error(`Node ${nodeId} is a folder and has no content`);
    }

    // Get the correct stores for this node's tree
    const { treeStore, contentStore } = this.getStoresForNode(node);

    // Create new version of content
    const newContentAtom = await contentStore.createVersion(
      node.contentId,
      newContent,
      createdBy
    );

    // Update node to point to new content
    (node as DocumentNode).contentId = newContentAtom.id;
    node.updatedAt = new Date().toISOString();
    await treeStore.saveNode(node);

    // Re-index the node with new content
    await this.vectorStore.add(
      nodeId,
      `${node.title}\n${node.gist}\n${newContent.slice(0, 500)}`
    );
    await this.vectorStore.save(node.treeId);

    return { node, newContent: newContentAtom };
  }

  /**
   * Get the version history of a content atom
   * Searches all storages (internal + KBs) for the content
   */
  async getContentHistory(contentId: string): Promise<ContentAtom[]> {
    // Try internal storage first
    const history = await this.contentStore.getHistory(contentId);
    if (history.length > 0) return history;

    // Try KB storages
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        const kbHistory = await kb.contentStore.getHistory(contentId);
        if (kbHistory.length > 0) return kbHistory;
      }
    }
    return [];
  }

  /**
   * Get the latest version of content (in case node points to old version)
   * Searches all storages for the content
   */
  async getLatestContent(contentId: string): Promise<ContentAtom | null> {
    // Try internal storage first
    const content = await this.contentStore.getLatestVersion(contentId);
    if (content) return content;

    // Try KB storages
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        const kbContent = await kb.contentStore.getLatestVersion(contentId);
        if (kbContent) return kbContent;
      }
    }
    return null;
  }

  /**
   * Check if content has been superseded by a newer version
   * Searches all storages
   */
  async isContentSuperseded(contentId: string): Promise<boolean> {
    // Try internal storage first
    const superseded = await this.contentStore.isSuperseded(contentId);
    if (superseded) return true;

    // Try KB storages
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        const kbSuperseded = await kb.contentStore.isSuperseded(contentId);
        if (kbSuperseded) return true;
      }
    }
    return false;
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
      // Use routing to get the correct tree store for this tree
      const treeStore = this.getTreeStoreForTree(treeId);
      const tree = await treeStore.getTree(treeId);

      // Find a leaf folder to place content
      const leafFolders = await treeStore.getLeafFolders(treeId);
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

  /**
   * Get content by ID. Note: For KB content, you should use the tree ID to route.
   * This searches all storages for the content.
   */
  async getContent(contentId: string): Promise<ContentAtom | null> {
    // Try main storage first
    let content = await this.contentStore.get(contentId);
    if (content) return content;

    // Try KB storages
    if (this.kbManager) {
      for (const kb of this.kbManager.list()) {
        content = await kb.contentStore.get(contentId);
        if (content) return content;
      }
    }
    return null;
  }

  /**
   * Get a node with its content (for hydration of references)
   */
  async getNodeWithContent(nodeId: string): Promise<{
    nodeId: string;
    title: string;
    gist: string;
    content: string;
    type: string;
    path: string;
  } | null> {
    const node = await this.getNode(nodeId);
    if (!node) return null;

    const { contentStore } = this.getStoresForNode(node);

    let content = '';
    if (hasContent(node)) {
      const contentAtom = await contentStore.get(node.contentId);
      content = contentAtom?.payload || '';
    }

    return {
      nodeId: node.id,
      title: node.title,
      gist: node.gist || '',
      content,
      type: node.type,
      path: node.path
    };
  }

  // ============ NODE OPERATIONS ============

  /**
   * Update node title and/or gist
   */
  async updateNode(nodeId: string, updates: { title?: string; gist?: string }): Promise<TreeNode> {
    const node = await this.getNode(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const { treeStore, contentStore } = this.getStoresForNode(node);

    if (updates.title !== undefined) {
      node.title = updates.title;
    }
    if (updates.gist !== undefined) {
      node.gist = updates.gist;
    }
    node.updatedAt = new Date().toISOString();

    await treeStore.saveNode(node);

    // Update vector index with new title/gist
    await this.vectorStore.remove(nodeId);
    let indexText = `${node.title}\n${node.gist}`;
    if (hasContent(node)) {
      const content = await contentStore.get(node.contentId);
      if (content) {
        indexText += `\n${content.payload.slice(0, 500)}`;
      }
    }
    await this.vectorStore.add(nodeId, indexText);
    await this.vectorStore.save(node.treeId);

    return node;
  }

  /**
   * Delete a content node (document or fragment).
   * Cascades to delete all children (fragments under a document).
   * Also removes associated content atoms and vector index entries.
   */
  async deleteNode(nodeId: string): Promise<{ deletedNodes: string[]; deletedContent: string[] }> {
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    // Don't allow deleting the root
    if (!node.parentId) {
      throw new Error('Cannot delete the root node');
    }

    const { treeStore, contentStore } = this.getStoresForNode(node);

    // Collect all nodes to delete (including descendants)
    const nodesToDelete: TreeNode[] = [];
    const contentIdsToDelete: string[] = [];

    const collectDescendants = async (n: TreeNode) => {
      nodesToDelete.push(n);
      if (hasContent(n)) {
        contentIdsToDelete.push(n.contentId);
      }
      const children = await treeStore.getChildren(n.id);
      for (const child of children) {
        await collectDescendants(child);
      }
    };
    await collectDescendants(node);

    const treeId = node.treeId;

    // Delete from tree (cascades children)
    await treeStore.deleteNode(nodeId);
    console.log(`🗑️ Deleted ${nodesToDelete.length} node(s) from tree`);

    // Remove from vector index
    for (const n of nodesToDelete) {
      await this.vectorStore.remove(n.id);
    }
    await this.vectorStore.save(treeId);
    console.log(`🗑️ Removed ${nodesToDelete.length} vector entries`);

    // Delete content atoms
    for (const contentId of contentIdsToDelete) {
      await contentStore.delete(contentId);
    }
    console.log(`🗑️ Deleted ${contentIdsToDelete.length} content atom(s)`);

    return {
      deletedNodes: nodesToDelete.map(n => n.id),
      deletedContent: contentIdsToDelete
    };
  }

  /**
   * Move node to a new parent folder
   * Enforces rules:
   * - Folders can move anywhere
   * - Documents/fragments can only move to leaf folders (no folder children)
   */
  async moveNode(nodeId: string, newParentId: string): Promise<TreeNode> {
    const node = await this.getNode(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const { treeStore } = this.getStoresForNode(node);

    const newParent = await treeStore.getNodeFromTree(node.treeId, newParentId);
    if (!newParent) throw new Error(`Target parent ${newParentId} not found`);
    if (!isFolder(newParent)) throw new Error(`Target ${newParentId} is not a folder`);

    // Check if newParent is valid for this node type
    if (node.type !== 'folder') {
      // Documents/fragments can only go into leaf folders (no folder children)
      const siblings = await treeStore.getChildren(newParentId);
      const hasSubfolders = siblings.some(s => s.type === 'folder');
      if (hasSubfolders) {
        throw new Error(`Cannot move ${node.type} into a folder that has subfolders`);
      }
    }

    // Update parent
    const oldParentId = node.parentId;
    node.parentId = newParentId;
    node.updatedAt = new Date().toISOString();

    await treeStore.saveNode(node);

    console.log(`📦 Moved node ${nodeId} from ${oldParentId} to ${newParentId}`);

    return node;
  }

  // ============ AUDIT LOG ============

  /**
   * Append an entry to the tree's audit log
   * Audit logs are stored as text files in trees/{treeId}.audit.log
   */
  async appendAudit(treeId: string, entry: {
    timestamp: string;
    action: string;
    details: string;
    actor: 'system' | 'ai' | 'human';
    sessionId?: string;
  }): Promise<void> {
    const logLine = `[${entry.timestamp}] [${entry.actor.toUpperCase()}] ${entry.action}: ${entry.details}${entry.sessionId ? ` (session: ${entry.sessionId})` : ''}`;
    await this.storage.appendLine(`trees/${treeId}.audit.log`, logLine);
  }

  /**
   * Append multiple audit entries at once (batch append)
   */
  async appendAuditBatch(treeId: string, entries: Array<{
    timestamp: string;
    action: string;
    details: string;
    actor: 'system' | 'ai' | 'human';
  }>, sessionId?: string): Promise<void> {
    for (const entry of entries) {
      await this.appendAudit(treeId, { ...entry, sessionId });
    }
    console.log(`📋 Appended ${entries.length} audit entries to ${treeId}`);
  }

  // ============ FILE PARSING ============

  /**
   * Parse a file (PDF, text, etc.) and extract text content
   * Uses the FileProcessor with appropriate parsers
   */
  async parseFile(fileName: string, buffer: Buffer): Promise<string | null> {
    console.log(`📄 Parsing file: ${fileName} (${buffer.length} bytes)`);
    const result = await this.fileProcessor.process(fileName, buffer);
    if (result) {
      console.log(`✅ Parsed ${fileName}: ${result.length} characters extracted`);
    } else {
      console.warn(`⚠️ Could not parse ${fileName}`);
    }
    return result;
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
      // Use routing to get node from correct storage
      const treeNode = await this.getNode(node.nodeId);
      const title = treeNode?.title || "Untitled Segment";

      let sourceInfo = "";
      if (node.contentId) {
        // Use routing to get content from correct storage
        const atom = await this.getContent(node.contentId);
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

  /**
   * Streaming version of ask - emits events as sources are found and answer is generated
   */
  async askStream(
    query: string,
    treeId: string,
    onEvent: (event: {
      type: 'source' | 'answer_chunk' | 'done' | 'error';
      data: any;
    }) => void
  ): Promise<void> {
    console.log(`\n🧠 [Synthesis Streaming] Asking: "${query}"`);

    try {
      // First, do retrieval and emit sources as we process them
      const retrieval = await this.retrieve({
        query,
        treeId,
        maxDepth: 5,
        resolution: 'L2'
      });

      if (retrieval.nodes.length === 0) {
        onEvent({
          type: 'answer_chunk',
          data: "I explored the knowledge tree but found no relevant information to answer your question."
        });
        onEvent({ type: 'done', data: { references: [] } });
        return;
      }

      // Process nodes and emit sources as they're discovered
      const contextBlocks: string[] = [];
      const references: string[] = [];

      for (let i = 0; i < retrieval.nodes.length; i++) {
        const node = retrieval.nodes[i];
        // Use routing to get node from correct storage
        const treeNode = await this.getNode(node.nodeId);
        const title = treeNode?.title || "Untitled Segment";

        let sourceInfo = "";
        if (node.contentId) {
          // Use routing to get content from correct storage
          const atom = await this.getContent(node.contentId);
          if (atom?.sourceUri) {
            const filename = atom.sourceUri.split('/').pop();
            sourceInfo = `(File: ${filename})`;
          }
        }

        // Emit the source as it's discovered
        onEvent({
          type: 'source',
          data: {
            index: i + 1,
            title,
            path: node.path,
            sourceInfo,
            preview: node.content.slice(0, 200) + (node.content.length > 200 ? '...' : ''),
            gist: treeNode?.gist || '',
            nodeId: node.nodeId,
            contentId: node.contentId,
            fullContent: node.content
          }
        });

        contextBlocks.push(`--- [SOURCE ${i+1}] Title: "${title}" ${sourceInfo} ---\n${node.content}`);
        references.push(node.path);
      }

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

      console.log(`   📝 Streaming answer from ${retrieval.nodes.length} sources...`);

      // Check if the LLM adapter supports streaming
      if (this.smartLlm.stream) {
        await this.smartLlm.stream(prompt, {}, (chunk) => {
          onEvent({ type: 'answer_chunk', data: chunk });
        });
      } else {
        // Fallback to non-streaming
        const answer = await this.smartLlm.complete(prompt, {});
        onEvent({ type: 'answer_chunk', data: answer });
      }

      onEvent({ type: 'done', data: { references } });

    } catch (error: any) {
      console.error('askStream error:', error);
      onEvent({ type: 'error', data: error.message || 'Unknown error' });
    }
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
      // Use routing to get the correct stores for this tree
      const treeStore = this.getTreeStoreForTree(treeId);
      const contentStore = this.getContentStoreForTree(treeId);

      const tree = await treeStore.getTree(treeId);
      const allNodes = await treeStore.getAllNodes(treeId);

      for (const node of allNodes) {
        if (node.id === tree.rootNodeId) continue;

        // Check orphan nodes
        if (node.parentId) {
          const parent = await treeStore.getNode(node.parentId);
          if (!parent) {
            result.orphanNodes.push(node.id);
            result.valid = false;
          }
        }

        // Check missing content refs
        if (hasContent(node)) {
          const content = await contentStore.get(node.contentId);
          if (!content) {
            result.missingContentRefs.push(node.id);
            result.valid = false;
          }
        }

        // Check constraint violations
        if (node.parentId) {
          const parent = await treeStore.getNode(node.parentId);
          if (parent) {
            // Folder with both folder and document children
            if (isFolder(parent)) {
              const siblings = await treeStore.getChildren(node.parentId);
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

    // Use routing to get the correct tree store
    const treeStore = this.getTreeStoreForTree(treeId);
    const treeMap = await treeStore.generateTreeMap(treeId);
    const treeConfig = await treeStore.getTree(treeId);

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
    // Check if tree is from internal config
    const treeConfig = this.config.trees.find(t => t.id === treeId);

    // Use routing to get the correct stores
    const treeStore = this.getTreeStoreForTree(treeId);
    const contentStore = this.getContentStoreForTree(treeId);

    console.log(`🔥 Resetting Tree: ${treeId}`);

    await treeStore.deleteTree(treeId);
    await this.vectorStore.deleteIndex(treeId);

    // Re-create tree - if from config, use config; otherwise get from KB
    if (treeConfig) {
      await treeStore.createTree(treeConfig);
    } else {
      // For KB trees, we need to look up the tree config from KB
      if (this.kbManager) {
        for (const kb of this.kbManager.list()) {
          if (treeId.startsWith(kb.id)) {
            const newTreeConfig = kb.getTreeConfig(treeId.replace(`${kb.id}-`, ''));
            await treeStore.createTree(newTreeConfig);
            break;
          }
        }
      }
    }

    if (options.pruneContent) {
      console.log(`   🧹 Pruning derived chunks...`);
      const count = await contentStore.pruneDerived();
      console.log(`   ✅ Removed ${count} generated fragments.`);
    }

    console.log(`✅ Tree ${treeId} reset to factory settings.`);
  }

  clearCache(treeId?: string) {
    // Clear cache on internal store
    this.treeStore.clearCache(treeId);
    // Also clear on KB stores if applicable
    if (this.kbManager && treeId) {
      const treeStore = this.getTreeStoreForTree(treeId);
      if (treeStore !== this.treeStore) {
        treeStore.clearCache(treeId);
      }
    } else if (this.kbManager && !treeId) {
      // Clear all caches
      for (const kb of this.kbManager.list()) {
        kb.treeStore.clearCache();
      }
    }
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

  /**
   * Initialize trees from loaded knowledge bases
   */
  private async initializeKnowledgeBases(): Promise<void> {
    if (!this.kbManager) return;

    for (const kb of this.kbManager.list()) {
      // Check what trees exist in this KB
      const existingTreeIds = await kb.listTrees();

      // If no trees exist, create the default tree
      if (existingTreeIds.length === 0) {
        const treeConfig = kb.getTreeConfig();

        // Create tree in the KB's storage
        // For now, we create trees in the main storage for simplicity
        // Future: each KB will have its own TreeStore
        const existingTrees = await this.treeStore.listTrees();
        if (!existingTrees.some(t => t.id === treeConfig.id)) {
          await this.treeStore.createTree(treeConfig);
          console.log(`🌱 Created tree for KB "${kb.name}": ${treeConfig.name}`);
        }
      }
    }
  }

  // ============ KNOWLEDGE BASE MANAGEMENT ============

  /**
   * List all loaded knowledge bases
   */
  listKnowledgeBases(): { id: string; name: string; path: string; organizingPrinciple: string }[] {
    if (!this.kbManager) return [];
    return this.kbManager.list().map(kb => kb.toJSON());
  }

  /**
   * Discover all knowledge bases in the storage path
   * Returns both loaded and unloaded KBs
   */
  async discoverKnowledgeBases(): Promise<DiscoveredKB[]> {
    if (!this.kbManager) return [];
    return this.kbManager.discover();
  }

  /**
   * Get the KB storage path
   */
  getKbStoragePath(): string | null {
    return this.kbManager?.getKbStoragePath() || null;
  }

  /**
   * Get a knowledge base by ID
   */
  getKnowledgeBase(id: string): KnowledgeBase | undefined {
    return this.kbManager?.get(id);
  }

  /**
   * Create a new knowledge base (legacy method with explicit path)
   */
  async createKnowledgeBase(
    relativePath: string,
    options: {
      id: string;
      name: string;
      organizingPrinciple: string;
      seedFolders?: KnowledgeBaseConfig['seedFolders'];
      dogma?: KnowledgeBaseConfig['dogma'];
    }
  ): Promise<KnowledgeBase> {
    if (!this.kbManager) {
      // Initialize KB manager if not present
      const configDir = this.configPath ? dirname(this.configPath) : process.cwd();
      this.kbManager = new KnowledgeBaseManager(configDir);
    }

    const kb = await this.kbManager.create(relativePath, options);

    // Create the default tree in the KB's own storage (portable!)
    const tree = await kb.createTree();
    console.log(`🌱 Created tree for new KB "${kb.name}": ${tree.name} (in ${kb.path}/trees/)`);

    return kb;
  }

  /**
   * Create a new knowledge base in the default storage path
   * Simpler API - just provide name and organizing principle
   */
  async createKnowledgeBaseInStorage(options: {
    name: string;
    organizingPrinciple: string;
    seedFolders?: KnowledgeBaseConfig['seedFolders'];
    dogma?: KnowledgeBaseConfig['dogma'];
  }): Promise<KnowledgeBase> {
    if (!this.kbManager) {
      // Initialize KB manager if not present
      const configDir = this.configPath ? dirname(this.configPath) : process.cwd();
      this.kbManager = new KnowledgeBaseManager(configDir);
    }

    const kb = await this.kbManager.createInStorage(options);

    // Create the default tree in the KB's own storage (portable!)
    const tree = await kb.createTree();
    console.log(`🌱 Created tree for new KB "${kb.name}": ${tree.name} (in ${kb.path}/trees/)`);

    return kb;
  }

  /**
   * Load an existing knowledge base from a path.
   * The KB's trees/content/indexes are in its own folder (portable!).
   */
  async loadKnowledgeBase(kbPath: string): Promise<KnowledgeBase> {
    if (!this.kbManager) {
      // Initialize KB manager if not present
      const configDir = this.configPath ? dirname(this.configPath) : process.cwd();
      this.kbManager = new KnowledgeBaseManager(configDir);
    }

    // Load the KB - its trees are already in its own storage
    const kb = await this.kbManager.load(kbPath);

    // Log what trees are available in this KB
    const trees = await kb.listTrees();
    if (trees.length > 0) {
      console.log(`   📚 KB "${kb.name}" has ${trees.length} tree(s): ${trees.map(t => t.name).join(', ')}`);
    }

    return kb;
  }

  /**
   * Add a new tree to an existing knowledge base.
   * The tree is created in the KB's own storage folder (portable!).
   */
  async addTreeToKnowledgeBase(kbId: string, localTreeId: string, treeName?: string): Promise<void> {
    const kb = this.kbManager?.get(kbId);
    if (!kb) {
      throw new Error(`Knowledge base not found: ${kbId}`);
    }

    // Get the full tree ID (prefixed with KB ID)
    const fullTreeId = kb.getFullTreeId(localTreeId);

    // Check if tree already exists in KB's storage
    if (await kb.hasTree(fullTreeId)) {
      throw new Error(`Tree "${localTreeId}" already exists in KB "${kb.name}"`);
    }

    // Create the tree in the KB's own storage
    const treeConfig = kb.getTreeConfig(localTreeId);
    if (treeName) {
      treeConfig.name = treeName;
    }

    await kb.treeStore.createTree(treeConfig);
    console.log(`🌱 Created new tree "${localTreeId}" in KB "${kb.name}" (${kb.path}/trees/)`);
  }

  /**
   * Create a new tree in the internal (default) storage.
   * For trees not in a portable knowledge base.
   */
  async createTree(treeId: string, treeName: string, seedFolders?: { title: string; gist: string }[]): Promise<void> {
    // Check if tree already exists
    const existingTrees = await this.listTrees();
    if (existingTrees.some(t => t.id === treeId)) {
      throw new Error(`Tree "${treeId}" already exists`);
    }

    const treeConfig = {
      id: treeId,
      name: treeName,
      organizingPrinciple: `${treeName} knowledge tree`,
      autoPlace: false,
      seedFolders: seedFolders || [
        { title: 'General', gist: 'General content' }
      ]
    };

    await this.treeStore.createTree(treeConfig);
    console.log(`🌱 Created new tree "${treeId}" in internal storage`);
  }


  /**
   * Export selected trees to a new portable knowledge base.
   * Copies trees, their content atoms, and vector indexes.
   */
  async exportTreesToNewKB(
      treeIds: string[],
      options: {
        name: string;
        organizingPrinciple: string;
      }
  ): Promise<{ kb: KnowledgeBase; stats: { trees: number; nodes: number; content: number } }> {
    if (!this.kbManager) {
      const configDir = this.configPath ? dirname(this.configPath) : process.cwd();
      this.kbManager = new KnowledgeBaseManager(configDir);
    }

    if (treeIds.length === 0) {
      throw new Error('At least one tree must be selected for export');
    }

    console.log(`📦 Exporting ${treeIds.length} tree(s) to new KB "${options.name}"...`);

    // 1. Collect all content IDs from the selected trees
    const contentIds = new Set<string>();
    let totalNodes = 0;

    for (const treeId of treeIds) {
      // Use routing to get the correct tree store
      const treeStore = this.getTreeStoreForTree(treeId);
      const tree = await treeStore.getTree(treeId);
      if (!tree) {
        throw new Error(`Tree not found: ${treeId}`);
      }

      const allNodes = await treeStore.getAllNodes(treeId);
      totalNodes += allNodes.length;

      for (const node of allNodes) {
        if (hasContent(node)) {
          contentIds.add(node.contentId);
        }
      }
    }

    console.log(`   Found ${totalNodes} nodes with ${contentIds.size} content atoms`);

    // 2. Create the new KB
    await this.kbManager.ensureStorageDir();

    // Generate folder name from name
    const folderName = options.name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 50);

    const id = `kb-${folderName}-${Date.now().toString(36)}`;
    const kbPath = resolve(this.kbManager.getKbStoragePath(), folderName);

    // Check if folder already exists
    let finalPath = kbPath;
    let counter = 1;
    const { existsSync } = await import('fs');
    while (existsSync(finalPath)) {
      finalPath = `${kbPath}-${counter}`;
      counter++;
    }

    // Create KB structure manually (without default tree)
    const { mkdir, writeFile, copyFile } = await import('fs/promises');
    const { join } = await import('path');

    await mkdir(finalPath, { recursive: true });
    await mkdir(join(finalPath, 'content'), { recursive: true });
    await mkdir(join(finalPath, 'indexes'), { recursive: true });
    await mkdir(join(finalPath, 'trees'), { recursive: true });

    // 3. Process Trees (Deep Copy & Rename)
    // We maintain a mapping of oldTreeId -> newTreeId to handle defaultTreeId assignment
    const treeIdMap = new Map<string, string>();

    // 3. Copy tree files
    const sourcePath = this.storage.getBasePath();

    for (const oldTreeId of treeIds) {
      // Load source tree data
      const sourceTreeStore = this.getTreeStoreForTree(oldTreeId);
      const treeFile = await sourceTreeStore.getTreeFile(oldTreeId);

      // Generate new Tree ID prefixed with KB ID
      // This ensures uniqueness and correct routing in the engine
      // e.g. "kb-new-business-coach"
      // Remove any existing KB prefix from the old ID to avoid double-prefixing
      const cleanSlug = oldTreeId.replace(/^kb-[a-z0-9-]+-/, '');
      const newTreeId = `${id}-${cleanSlug}`;

      treeIdMap.set(oldTreeId, newTreeId);

      // Deep Clone to avoid mutating cached data
      const newTreeFile = JSON.parse(JSON.stringify(treeFile));

      // Update Config
      newTreeFile.config.id = newTreeId;
      newTreeFile.config.kbId = id;
      // Optionally update name to indicate export? No, keep original name.

      // Update All Nodes
      for (const nodeId in newTreeFile.nodes) {
        newTreeFile.nodes[nodeId].treeId = newTreeId;
      }

      // Write modified tree to new KB location
      const destTreePath = join(finalPath, 'trees', `${newTreeId}.json`);
      await writeFile(destTreePath, JSON.stringify(newTreeFile, null, 2), 'utf-8');

      console.log(`   📄 Migrated tree: ${oldTreeId} -> ${newTreeId}`);

      // 3b. Copy & Rename Vector Index
      const sourceIndexPath = join(sourcePath, 'indexes', `${oldTreeId}.vectors.json`);
      const destIndexPath = join(finalPath, 'indexes', `${newTreeId}.vectors.json`); // Use new ID

      if (existsSync(sourceIndexPath)) {
        try {
          // We need to rewrite IDs inside the vector index?
          // No, vector entries key off 'nodeId' which didn't change.
          // We just need the file to be named correctly for the VectorStore to find it.
          await copyFile(sourceIndexPath, destIndexPath);
          console.log(`   🔍 Copied vector index`);
        } catch (err: any) {
          console.warn(`   ⚠️ Error copying index: ${err.message}`);
        }
      }
    }

    // 4. Copy Content (Immutable, so raw copy is fine)
    let copiedContent = 0;
    for (const contentId of contentIds) {
      const sourceContentPath = join(sourcePath, 'content', `${contentId}.json`);
      const destContentPath = join(finalPath, 'content', `${contentId}.json`);
      try {
        await copyFile(sourceContentPath, destContentPath);
        copiedContent++;
      } catch (err: any) {
        console.warn(`   ⚠️ Could not copy content ${contentId}: ${err.message}`);
      }
    }
    console.log(`   📦 Copied ${copiedContent} content atoms`);

    // 5. Write kb.json with new IDs
    const kbConfig: KnowledgeBaseConfig = {
      id,
      name: options.name,
      organizingPrinciple: options.organizingPrinciple,
      // Map the first selected tree's old ID to its new ID for default
      defaultTreeId: treeIdMap.get(treeIds[0]) || 'main',
    };
    await writeFile(join(finalPath, 'kb.json'), JSON.stringify(kbConfig, null, 2), 'utf-8');

    // 6. Load and register the new KB
    const kb = await KnowledgeBase.load(finalPath);
    // Access private map via casting or public method if available.
    // Since we are inside Fraktag class which has access to private kbManager...
    // But kbManager.knowledgeBases is private.
    // We should use a public method on kbManager to register.
    // Ideally kbManager.load() returns it and adds it.

    // Refresh the manager's list by re-scanning or force loading path
    // Since we are in Fraktag class, we can just reload the specific path
    await this.kbManager.load(finalPath);

    console.log(`✅ Export complete! New KB "${kb.name}" at ${finalPath}`);

    return {
      kb,
      stats: {
        trees: treeIds.length,
        nodes: totalNodes,
        content: copiedContent
      }
    };
  }

  // ============ CONVERSATION MANAGEMENT ============

  /**
   * Get or create a conversation session for today
   */
  async getOrCreateConversationSession(kbId: string): Promise<ConversationSession> {
    const folder = await this.conversationManager.getOrCreateTodaySession(kbId);
    // Use routing to get children from correct tree store
    const treeStore = this.getTreeStoreForTree(folder.treeId);
    const turns = await treeStore.getChildren(folder.id);
    return {
      id: folder.id,
      treeId: folder.treeId,
      title: folder.title,
      startedAt: folder.createdAt,
      turnCount: turns.length
    };
  }

  /**
   * Create a new conversation session
   */
  async createConversationSession(kbId: string, title?: string): Promise<ConversationSession> {
    const folder = await this.conversationManager.createSession(kbId, title);
    return {
      id: folder.id,
      treeId: folder.treeId,
      title: folder.title,
      startedAt: folder.createdAt,
      turnCount: 0
    };
  }

  /**
   * List all conversation sessions for a knowledge base
   */
  async listConversationSessions(kbId: string): Promise<ConversationSession[]> {
    return this.conversationManager.listSessions(kbId);
  }

  /**
   * Get all turns in a conversation session
   */
  async getConversationTurns(sessionId: string): Promise<ConversationTurn[]> {
    return this.conversationManager.getSessionTurns(sessionId);
  }

  /**
   * Delete a conversation session
   */
  async deleteConversationSession(sessionId: string): Promise<void> {
    return this.conversationManager.deleteSession(sessionId);
  }

  /**
   * Update a conversation session (title, etc.)
   */
  async updateConversationSession(
    sessionId: string,
    updates: { title?: string }
  ): Promise<ConversationSession> {
    return this.conversationManager.updateSession(sessionId, updates);
  }

  /**
   * Chat with memory - asks a question, logs the conversation, returns the answer
   * This combines retrieval, generation, and conversation logging
   * @param sourceTreeIds - array of tree IDs to search across
   */
  async chat(
    kbId: string,
    sessionId: string,
    question: string,
    sourceTreeIds: string | string[],
    onEvent?: (event: { type: 'source' | 'answer_chunk' | 'done' | 'error'; data: any }) => void
  ): Promise<{ answer: string; references: ConversationReference[] }> {
    // Normalize to array
    const treeIds = Array.isArray(sourceTreeIds) ? sourceTreeIds : [sourceTreeIds];

    // References for storage (just nodeIds)
    const references: ConversationReference[] = [];
    // Full source data for streaming events
    const sourceData: { nodeId: string; title: string }[] = [];
    const contextBlocks: string[] = [];
    let sourceIndex = 0;

    console.log(`💬 Chat: "${question.slice(0, 50)}..." across ${treeIds.length} trees`);

    // 1. Retrieve relevant content from all source trees
    for (const treeId of treeIds) {
      try {
        const retrieval = await this.navigator.retrieve({
          treeId,
          query: question,
          maxDepth: 5,
          resolution: 'L2'
        });

        for (const node of retrieval.nodes) {
          sourceIndex++;
          // Use routing to get node from correct storage
          const treeNode = await this.getNode(node.nodeId);
          const title = treeNode?.title || 'Untitled';
          const gist = treeNode?.gist || '';

          // Store just nodeId for persistence
          references.push({ nodeId: node.nodeId });
          // Keep title for return value
          sourceData.push({ nodeId: node.nodeId, title });

          // Emit source event with fullContent for popup display
          if (onEvent) {
            onEvent({
              type: 'source',
              data: {
                index: sourceIndex,
                title,
                path: node.path,
                preview: node.content.slice(0, 200),
                fullContent: node.content,
                gist,
                nodeId: node.nodeId,
                treeId
              }
            });
          }

          contextBlocks.push(`--- [SOURCE ${sourceIndex}] ${title} ---\n${node.content}`);
        }
      } catch (e) {
        console.warn(`Failed to retrieve from tree ${treeId}:`, e);
      }
    }

    console.log(`📚 Found ${sourceIndex} sources for context`);

    // 2. Generate answer
    const context = contextBlocks.join('\n\n');

    if (contextBlocks.length === 0) {
      const noContextAnswer = "I couldn't find any relevant information in the selected knowledge sources to answer your question.";
      if (onEvent) {
        onEvent({ type: 'answer_chunk', data: { text: noContextAnswer } });
        onEvent({ type: 'done', data: { references: [] } });
      }
      await this.conversationManager.logTurn(kbId, sessionId, {
        question,
        answer: noContextAnswer,
        references: []
      });
      return { answer: noContextAnswer, references: [] };
    }

    const prompt = `You are the Oracle. Answer the user's question using ONLY the provided context.

Guidelines:
- Cite sources as [1], [2], etc.
- If you cannot answer from the context, say so honestly.
- Be concise but thorough.

Context:
${context}

User Question: ${question}

Answer:`;

    let answer = '';

    try {
      console.log(`🤖 Generating answer with LLM...`);

      if (onEvent && this.smartLlm.stream) {
        // Streaming mode
        await this.smartLlm.stream(prompt, {}, (chunk: string) => {
          answer += chunk;
          onEvent({ type: 'answer_chunk', data: { text: chunk } });
        });
      } else {
        // Non-streaming mode - still emit the answer as chunks for the client
        answer = await this.smartLlm.complete(prompt, {});
        if (onEvent) {
          onEvent({ type: 'answer_chunk', data: { text: answer } });
        }
      }

      console.log(`✅ Answer generated (${answer.length} chars)`);

      if (onEvent) {
        onEvent({ type: 'done', data: { references: sourceData.map(s => s.title) } });
      }
    } catch (e: any) {
      console.error(`❌ LLM error:`, e);
      const errorMsg = `Error generating answer: ${e.message || 'Unknown error'}`;
      if (onEvent) {
        onEvent({ type: 'error', data: { message: errorMsg } });
      }
      answer = errorMsg;
    }

    // 3. Log the conversation turn
    await this.conversationManager.logTurn(kbId, sessionId, {
      question,
      answer,
      references
    });

    return { answer, references };
  }

  /**
   * Get the conversation tree ID for a knowledge base
   */
  getConversationTreeId(kbId: string): string {
    return this.conversationManager.getConversationTreeId(kbId);
  }

  private createLLMAdapter(config: FraktagConfig['llm']): ILLMAdapter {
    switch (config.adapter) {
      case 'ollama':
        return new OllamaAdapter({
          endpoint: config.endpoint ?? 'http://localhost:11434',
          model: config.model,
          timeoutMs: config.timeoutMs,
          numCtx: config.numCtx
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
export { DiscoveredKB } from './core/KnowledgeBase.js';
export { ConversationSession, ConversationTurn, ConversationReference, TurnData } from './core/ConversationManager.js';
