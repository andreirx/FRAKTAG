// packages/engine/src/core/Fractalizer.ts
// SIMPLIFIED INGESTION ENGINE
// Full auto-split/auto-place logic removed - will be replaced by human-assisted workflow

import { ContentStore } from './ContentStore.js';
import { TreeStore } from './TreeStore.js';
import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import {
  TreeNode,
  DocumentNode,
  FragmentNode,
  IngestionConfig,
  PromptSet,
  SplitAnalysis,
  DetectedSplit,
  ContentEditMode,
  ChunkingConfig,
  DEFAULT_CHUNKING_CONFIG,
  hasContent
} from './types.js';
import { VectorStore } from './VectorStore.js';
import { GenerateGistNugget } from '../nuggets/GenerateGist.js';
import { GenerateTitleNugget } from '../nuggets/GenerateTitle.js';
import { AiSplitNugget } from '../nuggets/AiSplit.js';
import { ProposePlacementNugget } from '../nuggets/ProposePlacement.js';
import { type IChunkingStrategy, type Chunk, createChunker } from '../adapters/chunking/index.js';

/**
 * Store resolver interface for KB-aware operations
 */
export interface StoreResolver {
  getTreeStoreForTree(treeId: string): TreeStore;
  getContentStoreForTree(treeId: string): ContentStore;
  getVectorStoreForTree(treeId: string): VectorStore;
}

export class Fractalizer {
  private storeResolver?: StoreResolver;
  private gistNugget: GenerateGistNugget;
  private titleNugget: GenerateTitleNugget;
  private aiSplitNugget: AiSplitNugget;
  private placementNugget: ProposePlacementNugget;
  private chunkingConfig: ChunkingConfig;
  private embeddingChunker: IChunkingStrategy;

  constructor(
    private contentStore: ContentStore,
    private treeStore: TreeStore,
    private vectorStore: VectorStore,
    private basicLlm: ILLMAdapter,
    private smartLlm: ILLMAdapter,
    private config: IngestionConfig,
    private prompts: PromptSet,
    chunkingConfig?: ChunkingConfig
  ) {
    this.gistNugget = new GenerateGistNugget(basicLlm, prompts.generateGist);
    this.titleNugget = new GenerateTitleNugget(basicLlm, prompts.generateTitle || prompts.generateGist);
    this.aiSplitNugget = new AiSplitNugget(smartLlm);
    this.placementNugget = new ProposePlacementNugget(smartLlm, prompts.proposePlacement);

    // Initialize chunking
    this.chunkingConfig = chunkingConfig ?? DEFAULT_CHUNKING_CONFIG;
    this.embeddingChunker = createChunker(this.chunkingConfig.embeddingStrategy);
  }

  /**
   * Set a store resolver for KB-aware operations.
   * When set, the Fractalizer will use the resolver to get the correct stores for each tree.
   */
  setStoreResolver(resolver: StoreResolver): void {
    this.storeResolver = resolver;
  }

  /**
   * Get the correct TreeStore for a tree (uses resolver if set, otherwise falls back to default)
   */
  private getTreeStore(treeId: string): TreeStore {
    if (this.storeResolver) {
      return this.storeResolver.getTreeStoreForTree(treeId);
    }
    return this.treeStore;
  }

  /**
   * Get the correct ContentStore for a tree (uses resolver if set, otherwise falls back to default)
   */
  private getContentStore(treeId: string): ContentStore {
    if (this.storeResolver) {
      return this.storeResolver.getContentStoreForTree(treeId);
    }
    return this.contentStore;
  }

  /**
   * Get the correct VectorStore for a tree (uses resolver if set, otherwise falls back to default)
   */
  private getVectorStore(treeId: string): VectorStore {
    if (this.storeResolver) {
      return this.storeResolver.getVectorStoreForTree(treeId);
    }
    return this.vectorStore;
  }

  // ============ EMBEDDING INDEXING ============

  /**
   * Index content for retrieval using the configured chunking strategy
   *
   * When multiChunkEmbeddings is enabled, splits content into overlapping chunks
   * for better retrieval coverage. Each chunk is prefixed with title+gist for
   * metadata searchability.
   *
   * @param nodeId - The tree node ID
   * @param treeId - The tree ID (for store resolution)
   * @param title - Document/fragment title
   * @param gist - Document/fragment gist
   * @param content - Full content to index
   */
  private async indexForRetrieval(
    nodeId: string,
    treeId: string,
    title: string,
    gist: string,
    content: string
  ): Promise<void> {
    const vectorStore = this.getVectorStore(treeId);

    if (this.chunkingConfig.multiChunkEmbeddings && content.length > 500) {
      // Multi-chunk mode: split content and create multiple embeddings
      const chunks = await this.embeddingChunker.chunk(content, {
        maxTokens: this.chunkingConfig.embeddingChunkTokens,
        overlapTokens: this.chunkingConfig.embeddingOverlapTokens,
        minChunkTokens: this.chunkingConfig.minChunkTokens,
      });

      if (chunks.length > 0) {
        // Enrich chunks with title+gist for metadata searchability
        const enrichedChunks: Chunk[] = chunks.map((chunk, i) => ({
          ...chunk,
          // Prepend metadata to each chunk so title/gist keywords are searchable
          text: i === 0
            ? `${title}\n${gist}\n\n${chunk.text}`
            : `[${title}]\n${chunk.text}`,
        }));

        await vectorStore.addChunks(nodeId, enrichedChunks);
      } else {
        // Fallback if chunking produced no results
        await vectorStore.add(nodeId, `${title}\n${gist}\n${content.slice(0, 500)}`);
      }
    } else {
      // Legacy single-embedding mode (for short content or when disabled)
      await vectorStore.add(nodeId, `${title}\n${gist}\n${content.slice(0, 500)}`);
    }

    await vectorStore.save(treeId);
  }

  // ============ SPLIT ANALYSIS (Programmatic - No AI) ============

  /**
   * Analyze a file for potential splits using programmatic detection.
   * This is PHASE 1 of human-assisted ingestion.
   * Returns detected splits for human review.
   */
  analyzeSplits(content: string, sourceUri: string): SplitAnalysis {
    const splits = this.detectSplitPoints(content);

    return {
      sourceUri,
      fullText: content,
      suggestedTitle: this.extractTitle(content, sourceUri),
      detectedSplits: splits,
      splitMethod: splits.length > 0 ? this.determineSplitMethod(content) : 'NONE'
    };
  }

  private extractTitle(content: string, sourceUri: string): string {
    // Try to extract title from content (first line, first header, etc.)
    const lines = content.split('\n').filter(l => l.trim());

    // Check for markdown title
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1].trim();

    // Check for first non-empty line if it's short enough to be a title
    if (lines.length > 0 && lines[0].length < 100) {
      return lines[0].trim();
    }

    // Fall back to filename from sourceUri
    const filename = sourceUri.split('/').pop() || 'Untitled';
    return filename.replace(/\.[^.]+$/, ''); // Remove extension
  }

  private determineSplitMethod(content: string): 'TOC' | 'PDF_PAGE' | 'HEADER' | 'HR' | 'NONE' {
    // Check for TOC first (for PDFs with table of contents)
    if (this.hasToc(content)) return 'TOC';
    if (/---=== PAGE \d+ ===---/.test(content)) return 'PDF_PAGE';
    if (/^##?\s+.+$/m.test(content)) return 'HEADER';
    if (/^\s*---\s*$/m.test(content)) return 'HR';
    return 'NONE';
  }

  /**
   * Check if content has a detectable Table of Contents
   */
  private hasToc(content: string): boolean {
    // Look for TOC header patterns
    const tocHeaderPattern = /^(table\s+of\s+contents|contents|toc)\s*$/im;
    if (!tocHeaderPattern.test(content)) return false;

    // Check if there are TOC-style entries (title followed by dots/spaces and page number)
    const tocEntryPattern = /^.{3,80}[.\s]{3,}\d+\s*$/m;
    const tocMatches = content.match(new RegExp(tocEntryPattern.source, 'gm'));

    return tocMatches !== null && tocMatches.length >= 3;
  }

  /**
   * Split content based on Table of Contents entries.
   * This is the preferred method for PDFs as it uses semantic structure.
   */
  private splitByToc(content: string): DetectedSplit[] {
    // 1. Find the TOC section
    const tocHeaderMatch = content.match(/^(table\s+of\s+contents|contents|toc)\s*$/im);
    if (!tocHeaderMatch || tocHeaderMatch.index === undefined) return [];

    const tocStartIndex = tocHeaderMatch.index;

    // 2. Find where TOC ends (usually before a page marker or substantial content)
    // Look for first page marker, or substantial paragraph after TOC entries end
    const afterTocHeader = content.slice(tocStartIndex + tocHeaderMatch[0].length);

    // TOC entries typically look like: "Chapter 1: Introduction ..... 5" or "1.1 Background   15"
    const tocEntryPattern = /^(.{3,80}?)\s*[.\s]{2,}(\d+)\s*$/gm;
    const tocEntries: { title: string; pageNum: number; originalLine: string }[] = [];

    let match;
    let lastMatchEnd = 0;
    while ((match = tocEntryPattern.exec(afterTocHeader)) !== null) {
      // Stop if we hit a page marker (end of TOC)
      const textBetween = afterTocHeader.slice(lastMatchEnd, match.index);
      if (/---=== PAGE \d+ ===---/.test(textBetween) && tocEntries.length > 0) {
        break;
      }

      const title = match[1].trim()
        .replace(/^[\d.]+\s*/, '')  // Remove leading numbers like "1.1 " or "Chapter 1: "
        .replace(/^(chapter|section|part)\s*\d*:?\s*/i, '') // Remove chapter/section prefixes
        .trim();

      if (title.length >= 3 && title.length <= 100) {
        tocEntries.push({
          title,
          pageNum: parseInt(match[2], 10),
          originalLine: match[0].trim()
        });
      }
      lastMatchEnd = match.index + match[0].length;
    }

    if (tocEntries.length < 2) return [];

    console.log(`📑 Found TOC with ${tocEntries.length} entries`);

    // 3. Find where each TOC entry appears in the document body
    // We'll look for the titles after the TOC section
    const bodyContent = content.slice(tocStartIndex + 500); // Skip past TOC itself
    const splits: DetectedSplit[] = [];
    const foundPositions: { title: string; index: number; globalIndex: number }[] = [];

    for (const entry of tocEntries) {
      // Try to find this title in the body - it might be in various formats
      const escapedTitle = entry.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Try multiple patterns to find the title in the body
      let bestMatch: { index: number; length: number } | null = null;

      // Pattern 1: Exact match (possibly with leading number)
      const pattern1 = new RegExp(`^[\\d.]*\\s*${escapedTitle}\\s*$`, 'im');
      const match1 = bodyContent.match(pattern1);
      if (match1 && match1.index !== undefined) {
        bestMatch = { index: match1.index, length: match1[0].length };
      }

      // Pattern 2: With chapter/section prefix (only if pattern 1 didn't match)
      if (!bestMatch) {
        const pattern2 = new RegExp(`^(chapter|section|part)?\\s*[\\d.]*\\s*:?\\s*${escapedTitle}`, 'im');
        const match2 = bodyContent.match(pattern2);
        if (match2 && match2.index !== undefined) {
          bestMatch = { index: match2.index, length: match2[0].length };
        }
      }

      // Pattern 3: Just the title starting a line (fallback)
      if (!bestMatch) {
        const pattern3 = new RegExp(`^${escapedTitle}`, 'im');
        const match3 = bodyContent.match(pattern3);
        if (match3 && match3.index !== undefined) {
          bestMatch = { index: match3.index, length: match3[0].length };
        }
      }

      if (bestMatch) {
        const globalIndex = tocStartIndex + 500 + bestMatch.index;
        foundPositions.push({ title: entry.title, index: bestMatch.index, globalIndex });
      }
    }

    // Sort by position in document
    foundPositions.sort((a, b) => a.index - b.index);

    // 4. Create splits at found positions
    // Add preamble if there's content before the first found section
    const firstSectionIndex = foundPositions[0]?.globalIndex;
    if (firstSectionIndex && firstSectionIndex > tocStartIndex + 1000) {
      // There might be some content between TOC and first section (front matter, etc.)
      // We'll skip this as it's usually formatting cruft from PDF extraction
    }

    for (let i = 0; i < foundPositions.length; i++) {
      const current = foundPositions[i];
      const next = foundPositions[i + 1];

      const startIndex = current.globalIndex;
      const endIndex = next?.globalIndex ?? content.length;
      const text = content.slice(startIndex, endIndex).trim();

      if (text.length > 50) { // Skip very short sections
        splits.push({
          title: current.title,
          text,
          startIndex,
          endIndex,
          confidence: 0.9 // High confidence for TOC-based splits
        });
      }
    }

    if (splits.length >= 2) {
      console.log(`✅ TOC-based split created ${splits.length} sections`);
      return splits;
    }

    return [];
  }

  private detectSplitPoints(content: string): DetectedSplit[] {
    const splits: DetectedSplit[] = [];
    const len = content.length;

    if (len < 500) return []; // Too short to split

    // Try TOC-based splitting first (for PDFs with table of contents)
    const tocSplits = this.splitByToc(content);
    if (tocSplits.length > 1) return tocSplits;

    // Try PDF pages (fallback for PDFs without good TOC)
    const pdfSplits = this.splitByPdfPages(content);
    if (pdfSplits.length > 1) return pdfSplits;

    // Try headers
    const headerSplits = this.splitByHeaders(content);
    if (headerSplits.length > 1 && headerSplits.length <= 50) return headerSplits;

    // Try HR markers
    const hrSplits = this.splitByHrMarkers(content);
    if (hrSplits.length > 1 && hrSplits.length <= 50) return hrSplits;

    return splits;
  }

  private splitByPdfPages(content: string): DetectedSplit[] {
    const pageRegex = /---=== PAGE (\d+) ===---/g;
    const matches = [...content.matchAll(pageRegex)];

    if (matches.length < 2) return [];

    const splits: DetectedSplit[] = [];
    let lastIndex = 0;

    // Content before first page marker
    if (matches[0].index! > 0) {
      const text = content.slice(0, matches[0].index).trim();
      if (text.length > 0) {
        splits.push({
          title: 'Preamble',
          text,
          startIndex: 0,
          endIndex: matches[0].index!,
          confidence: 0.9
        });
      }
    }

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const pageNum = match[1];
      const startIndex = match.index! + match[0].length;
      const endIndex = matches[i + 1]?.index ?? content.length;
      const text = content.slice(startIndex, endIndex).trim();

      if (text.length > 0) {
        splits.push({
          title: `Page ${pageNum}`,
          text,
          startIndex,
          endIndex,
          confidence: 0.95
        });
      }
    }

    return splits;
  }

  private splitByHeaders(content: string): DetectedSplit[] {
    // Try H1, then H2
    const h1Regex = /^(#\s+.+)$/gm;
    const h2Regex = /^(##\s+.+)$/gm;

    let matches = [...content.matchAll(h1Regex)];
    if (matches.length < 2) {
      matches = [...content.matchAll(h2Regex)];
    }

    if (matches.length < 2) return [];

    const splits: DetectedSplit[] = [];

    // Content before first header
    if (matches[0].index! > 0) {
      const text = content.slice(0, matches[0].index).trim();
      if (text.length > 0) {
        splits.push({
          title: 'Introduction',
          text,
          startIndex: 0,
          endIndex: matches[0].index!,
          confidence: 0.7
        });
      }
    }

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const title = match[1].replace(/^#+\s*/, '').trim();
      const startIndex = match.index!;
      const endIndex = matches[i + 1]?.index ?? content.length;
      const text = content.slice(startIndex, endIndex).trim();

      splits.push({
        title,
        text,
        startIndex,
        endIndex,
        confidence: 0.85
      });
    }

    return splits;
  }

  private splitByHrMarkers(content: string): DetectedSplit[] {
    const hrRegex = /^\s*---\s*$/gm;
    const matches = [...content.matchAll(hrRegex)];

    if (matches.length < 2) return [];

    const splits: DetectedSplit[] = [];
    let lastIndex = 0;

    for (let i = 0; i <= matches.length; i++) {
      const endIndex = matches[i]?.index ?? content.length;
      const text = content.slice(lastIndex, endIndex).trim();

      if (text.length > 0 && !text.match(/^---\s*$/)) {
        splits.push({
          title: `Section ${splits.length + 1}`,
          text,
          startIndex: lastIndex,
          endIndex,
          confidence: 0.6
        });
      }

      if (matches[i]) {
        lastIndex = matches[i].index! + matches[i][0].length;
      }
    }

    return splits;
  }

  // ============ SIMPLE INGESTION (Direct - No Auto-Place) ============

  /**
   * Simple ingest: Create a document in a specified folder.
   * This bypasses all auto-placement logic.
   */
  async ingestDocument(
    content: string,
    treeId: string,
    parentFolderId: string,
    title: string,
    gist?: string,
    editMode: ContentEditMode = 'readonly'
  ): Promise<DocumentNode> {
    // Get the correct stores for this tree (KB-aware routing)
    const contentStore = this.getContentStore(treeId);
    const treeStore = this.getTreeStore(treeId);

    // 1. Create content atom
    const contentAtom = await contentStore.create({
      payload: content,
      mediaType: 'text/plain',
      createdBy: 'fractalizer',
      editMode
    });

    // 2. Generate gist if not provided (skip if content is empty/short)
    let finalGist = gist || '';
    if (!finalGist && content.trim().length > 10) {
      finalGist = await this.generateGist(content, treeId);
    }

    // 3. Create document node
    const doc = await treeStore.createDocument(
      treeId,
      parentFolderId,
      title,
      finalGist,
      contentAtom.id,
      editMode
    );

    // 4. Index for retrieval (using chunking strategy)
    await this.indexForRetrieval(doc.id, treeId, title, finalGist, content);

    return doc;
  }

  /**
   * Create a fragment under a document
   */
  async createFragment(
    content: string,
    treeId: string,
    parentDocumentId: string,
    title: string,
    gist?: string,
    editMode: ContentEditMode = 'readonly'
  ): Promise<FragmentNode> {
    // Get the correct stores for this tree (KB-aware routing)
    const contentStore = this.getContentStore(treeId);
    const treeStore = this.getTreeStore(treeId);

    // 1. Create content atom
    const contentAtom = await contentStore.create({
      payload: content,
      mediaType: 'text/plain',
      createdBy: 'fractalizer',
      editMode
    });

    // 2. Generate gist if not provided (skip if content is empty/short)
    let finalGist = gist || '';
    if (!finalGist && content.trim().length > 10) {
      finalGist = await this.generateGist(content, treeId);
    }

    // 3. Create fragment node
    const fragment = await treeStore.createFragment(
      treeId,
      parentDocumentId,
      title,
      finalGist,
      contentAtom.id,
      editMode
    );

    // 4. Index for retrieval (using chunking strategy)
    await this.indexForRetrieval(fragment.id, treeId, title, finalGist, content);

    return fragment;
  }

  /**
   * Generate a gist for content using LLM
   */
  async generateGist(content: string, treeId: string): Promise<string> {
    try {
      const treeStore = this.getTreeStore(treeId);
      const tree = await treeStore.getTree(treeId);
      return await this.gistNugget.run({
        content: content.slice(0, 3000),
        organizingPrinciple: tree.organizingPrinciple,
      });
    } catch (e) {
      // Fallback: first 100 chars
      return content.slice(0, 100).replace(/\n/g, ' ').trim() + '...';
    }
  }

  /**
   * Generate a title for content using LLM
   */
  async generateTitle(content: string, treeId: string): Promise<string> {
    try {
      const treeStore = this.getTreeStore(treeId);
      const tree = await treeStore.getTree(treeId);
      return await this.titleNugget.run({
        content: content.slice(0, 2000),
        organizingPrinciple: tree.organizingPrinciple,
      });
    } catch (e) {
      return 'Untitled Document';
    }
  }

  // ============ UPDATE OPERATIONS ============

  /**
   * Update the content of an existing document/fragment
   * Note: nodeId is used to find the node, then we route to the correct stores based on treeId
   */
  async updateNode(nodeId: string, newContent: string, treeId?: string): Promise<void> {
    // If treeId not provided, we need to find it from the node
    // This requires searching all stores - use default first
    let node = await this.treeStore.getNode(nodeId);
    let actualTreeStore = this.treeStore;
    let actualContentStore = this.contentStore;

    if (!node && this.storeResolver) {
      // Node not in default store, we need to search KB stores
      // This is a limitation - we'd need to iterate KBs
      // For now, if treeId is provided, use it
    }

    if (treeId) {
      actualTreeStore = this.getTreeStore(treeId);
      actualContentStore = this.getContentStore(treeId);
      node = await actualTreeStore.getNode(nodeId);
    }

    if (!node || !hasContent(node)) {
      throw new Error(`Node ${nodeId} not found or is not a content node`);
    }

    // Use the node's treeId for routing
    const nodeTreeStore = this.getTreeStore(node.treeId);
    const nodeContentStore = this.getContentStore(node.treeId);

    // 1. Create new content atom (versioned)
    const oldContentId = node.contentId;
    const newAtom = await nodeContentStore.create({
      payload: newContent,
      mediaType: 'text/plain',
      createdBy: 'fractalizer',
      supersedes: oldContentId
    });

    // 2. Update node
    (node as DocumentNode | FragmentNode).contentId = newAtom.id;
    node.gist = await this.generateGist(newContent, node.treeId);
    node.updatedAt = new Date().toISOString();

    await nodeTreeStore.saveNode(node);

    // 3. Update vector index (using KB-aware vector store)
    const nodeVectorStore = this.getVectorStore(node.treeId);
    await nodeVectorStore.remove(nodeId);
    await nodeVectorStore.add(nodeId, `${node.title}\n${node.gist}\n${newContent.slice(0, 500)}`);
    await nodeVectorStore.save(node.treeId);
  }

  /**
   * Regenerate gist for a node
   * Note: nodeId is used to find the node, then we route to correct stores based on treeId
   */
  async regenerateGist(nodeId: string, treeId?: string): Promise<void> {
    // Use routing based on treeId if provided
    let node: TreeNode | null = null;
    let actualTreeStore = this.treeStore;
    let actualContentStore = this.contentStore;

    if (treeId) {
      actualTreeStore = this.getTreeStore(treeId);
      actualContentStore = this.getContentStore(treeId);
    }

    node = await actualTreeStore.getNode(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    // Use the node's treeId for routing
    const nodeTreeStore = this.getTreeStore(node.treeId);
    const nodeContentStore = this.getContentStore(node.treeId);
    const nodeVectorStore = this.getVectorStore(node.treeId);

    if (hasContent(node)) {
      const content = await nodeContentStore.get(node.contentId);
      if (content) {
        node.gist = await this.generateGist(content.payload, node.treeId);
        node.updatedAt = new Date().toISOString();
        await nodeTreeStore.saveNode(node);

        // Update vector index (using KB-aware vector store)
        await nodeVectorStore.remove(nodeId);
        await nodeVectorStore.add(nodeId, `${node.title}\n${node.gist}\n${content.payload.slice(0, 500)}`);
        await nodeVectorStore.save(node.treeId);
      }
    }
  }

  // ============ AI-ASSISTED OPERATIONS ============

  /**
   * AI-assisted split generation
   * The AI analyzes content and proposes logical split points
   */
  async generateAiSplits(content: string, treeId: string): Promise<{ title: string; text: string }[]> {
    try {
      const treeStore = this.getTreeStore(treeId);
      const tree = await treeStore.getTree(treeId);
      return await this.aiSplitNugget.run({
        content: content.slice(0, 8000),
        organizingPrinciple: tree.organizingPrinciple,
      });
    } catch (e) {
      console.error('AI split failed:', e);
      // Fallback: return content as single section
      return [{ title: await this.generateTitle(content, treeId), text: content }];
    }
  }

  /**
   * AI-assisted placement proposal
   * The AI suggests which folder a document should be placed in
   */
  async proposePlacement(
    treeId: string,
    documentTitle: string,
    documentGist: string
  ): Promise<{ folderId: string; reasoning: string; confidence: number }> {
    try {
      const treeStore = this.getTreeStore(treeId);
      const leafFolders = await treeStore.getLeafFolders(treeId);

      if (leafFolders.length === 0) {
        throw new Error('No leaf folders available');
      }

      if (leafFolders.length === 1) {
        return {
          folderId: leafFolders[0].id,
          reasoning: 'Only one folder available',
          confidence: 1.0
        };
      }

      // Build folder list for prompt
      const folderList = leafFolders.map(f =>
        `- ID: ${f.id}\n  Title: ${f.title}\n  Gist: ${f.gist}\n  Path: ${f.path}`
      ).join('\n\n');

      const proposal = await this.placementNugget.run({
        documentTitle,
        documentGist: documentGist || 'No summary available',
        leafFolders: folderList,
      });

      // Validate the proposed folder exists
      const validFolder = leafFolders.find(f => f.id === proposal.targetFolderId);
      if (!validFolder) {
        return {
          folderId: leafFolders[0].id,
          reasoning: proposal.reasoning || 'Default folder selected',
          confidence: 0.5
        };
      }

      return {
        folderId: proposal.targetFolderId,
        reasoning: proposal.reasoning || 'AI-selected folder',
        confidence: proposal.confidence
      };
    } catch (e) {
      console.error('Placement proposal failed:', e);
      const treeStore = this.getTreeStore(treeId);
      const leafFolders = await treeStore.getLeafFolders(treeId);
      return {
        folderId: leafFolders[0]?.id || 'unknown',
        reasoning: 'Error during placement analysis',
        confidence: 0.3
      };
    }
  }

  // ============ LEGACY COMPATIBILITY (STUBBED) ============

  /**
   * @deprecated Use ingestDocument instead
   */
  async ingest(
    content: string,
    treeId: string,
    parentId: string | null,
    currentPath: string,
    depth: number = 0
  ): Promise<TreeNode> {
    console.warn('Fractalizer.ingest() is deprecated. Use ingestDocument() with explicit placement.');

    // Get the correct stores for this tree (KB-aware routing)
    const treeStore = this.getTreeStore(treeId);

    // Get a leaf folder to place content
    const tree = await treeStore.getTree(treeId);
    const targetParentId = parentId || tree.rootNodeId;

    // Try to use the parent directly, or find a leaf folder
    const parent = await treeStore.getNodeFromTree(treeId, targetParentId);
    if (!parent) throw new Error(`Parent ${targetParentId} not found`);

    // If parent is a folder, create document there
    // This may fail if parent is a branch folder - caller should handle
    const title = await this.generateTitle(content, treeId);
    return await this.ingestDocument(content, treeId, targetParentId, title);
  }

  /**
   * @deprecated No longer used in strict taxonomy
   */
  async regenerateSummaries(nodeId: string): Promise<void> {
    await this.regenerateGist(nodeId);
  }

  /**
   * @deprecated Use updateNode instead
   */
  async updateNodeContent(nodeId: string, newContentId: string, newContent: string): Promise<void> {
    await this.updateNode(nodeId, newContent);
  }
}
