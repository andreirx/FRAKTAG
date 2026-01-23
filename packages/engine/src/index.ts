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
import { KnowledgeBase, KnowledgeBaseManager } from './core/KnowledgeBase.js';

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
      instance.configPath = absolutePath;

      // Load knowledge bases if configured
      if (config.knowledgeBases && config.knowledgeBases.length > 0) {
        const configDir = dirname(absolutePath);
        instance.kbManager = new KnowledgeBaseManager(configDir);

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
   */
  async updateEditableContent(contentId: string, newPayload: string): Promise<ContentAtom> {
    const updated = await this.contentStore.updatePayload(contentId, newPayload);
    if (!updated) {
      throw new Error(`Content not found: ${contentId}`);
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
    // Find the node across all trees
    const node = await this.treeStore.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    if (!hasContent(node)) {
      throw new Error(`Node ${nodeId} is a folder and has no content`);
    }

    // Create new version of content
    const newContentAtom = await this.contentStore.createVersion(
      node.contentId,
      newContent,
      createdBy
    );

    // Update node to point to new content
    (node as DocumentNode).contentId = newContentAtom.id;
    node.updatedAt = new Date().toISOString();
    await this.treeStore.saveNode(node);

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
   */
  async getContentHistory(contentId: string): Promise<ContentAtom[]> {
    return await this.contentStore.getHistory(contentId);
  }

  /**
   * Get the latest version of content (in case node points to old version)
   */
  async getLatestContent(contentId: string): Promise<ContentAtom | null> {
    return await this.contentStore.getLatestVersion(contentId);
  }

  /**
   * Check if content has been superseded by a newer version
   */
  async isContentSuperseded(contentId: string): Promise<boolean> {
    return await this.contentStore.isSuperseded(contentId);
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

  /**
   * Move node to a new parent folder
   * Enforces rules:
   * - Folders can move anywhere
   * - Documents/fragments can only move to leaf folders (no folder children)
   */
  async moveNode(nodeId: string, newParentId: string): Promise<TreeNode> {
    const node = await this.treeStore.getNode(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const newParent = await this.treeStore.getNode(newParentId);
    if (!newParent) throw new Error(`Target parent ${newParentId} not found`);
    if (!isFolder(newParent)) throw new Error(`Target ${newParentId} is not a folder`);

    // Check if newParent is valid for this node type
    if (node.type !== 'folder') {
      // Documents/fragments can only go into leaf folders (no folder children)
      const siblings = await this.treeStore.getChildren(newParentId);
      const hasSubfolders = siblings.some(s => s.type === 'folder');
      if (hasSubfolders) {
        throw new Error(`Cannot move ${node.type} into a folder that has subfolders`);
      }
    }

    // Update parent
    const oldParentId = node.parentId;
    node.parentId = newParentId;
    node.updatedAt = new Date().toISOString();

    await this.treeStore.saveNode(node);

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

        // Emit the source as it's discovered
        onEvent({
          type: 'source',
          data: {
            index: i + 1,
            title,
            path: node.path,
            sourceInfo,
            preview: node.content.slice(0, 200) + (node.content.length > 200 ? '...' : '')
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
   * Get a knowledge base by ID
   */
  getKnowledgeBase(id: string): KnowledgeBase | undefined {
    return this.kbManager?.get(id);
  }

  /**
   * Create a new knowledge base
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

    // Create the default tree for this KB
    const treeConfig = kb.getTreeConfig();
    await this.treeStore.createTree(treeConfig);
    console.log(`🌱 Created tree for new KB "${kb.name}": ${treeConfig.name}`);

    return kb;
  }

  /**
   * Load an existing knowledge base from a path
   */
  async loadKnowledgeBase(kbPath: string): Promise<KnowledgeBase> {
    if (!this.kbManager) {
      // Initialize KB manager if not present
      const configDir = this.configPath ? dirname(this.configPath) : process.cwd();
      this.kbManager = new KnowledgeBaseManager(configDir);
    }

    // Load the KB
    const absolutePath = resolve(
      this.configPath ? dirname(this.configPath) : process.cwd(),
      kbPath
    );
    const kb = await KnowledgeBase.load(absolutePath);

    // Add to manager
    (this.kbManager as any).knowledgeBases.set(kb.id, kb);
    console.log(`📚 Loaded KB: ${kb.name} (${kb.id})`);

    // Initialize trees from this KB
    const treeIds = await kb.listTrees();
    for (const treeId of treeIds) {
      const exists = await this.treeStore.treeExists(treeId);
      if (!exists) {
        const treeConfig = kb.getTreeConfig(treeId);
        await this.treeStore.createTree(treeConfig);
        console.log(`   🌱 Initialized tree: ${treeConfig.name}`);
      }
    }

    return kb;
  }

  /**
   * Add a new tree to an existing knowledge base
   */
  async addTreeToKnowledgeBase(kbId: string, treeId: string, treeName?: string): Promise<void> {
    const kb = this.kbManager?.get(kbId);
    if (!kb) {
      throw new Error(`Knowledge base not found: ${kbId}`);
    }

    // Check if tree already exists
    if (await kb.hasTree(treeId)) {
      throw new Error(`Tree "${treeId}" already exists in KB "${kb.name}"`);
    }

    // Create tree config from KB
    const treeConfig = kb.getTreeConfig(treeId);
    if (treeName) {
      treeConfig.name = treeName;
    }

    await this.treeStore.createTree(treeConfig);
    console.log(`🌱 Created new tree "${treeId}" in KB "${kb.name}"`);
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
