// packages/engine/src/core/Fractalizer.ts

import { randomUUID } from 'crypto';
import { ContentStore } from './ContentStore.js';
import { TreeStore } from './TreeStore.js';
import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { TreeNode, IngestionConfig, PromptSet, TreeConfig } from './types.js';
import {VectorStore} from "./VectorStore.js";

/**
 * Fractalizer handles content ingestion: splitting, summarizing, and bubble-up
 */
export class Fractalizer {
  constructor(
    private contentStore: ContentStore,
    private treeStore: TreeStore,
    private vectorStore: VectorStore,
    private basicLlm: ILLMAdapter, // FAST
    private smartLlm: ILLMAdapter, // SMART
    private config: IngestionConfig,
    private prompts: PromptSet
  ) {}

  /**
   * Ingest content into a tree
   * If parentId is provided -> Direct placement (splitting use case)
   * If parentId is null -> Auto-placement (sorting use case)
   */
  async ingest(
    content: string,
    treeId: string,
    parentId: string | null,
    currentPath: string,
    depth: number = 0
  ): Promise<TreeNode> {
    const contentAtom = await this.contentStore.create({
      payload: content,
      mediaType: 'text/plain',
      createdBy: 'system',
    });

    const tree = await this.treeStore.getTree(treeId);
    const rawGist = await this.basicLlm.complete(
      this.prompts.generateGist,
      { content, organizingPrinciple: tree.organizingPrinciple }
    );

    const gist = await this.sanctify(content, rawGist, treeId, 'L0');

    if (parentId) {
      return this.processContentWithSplitting(
        content,
        contentAtom.id,
        gist,
        treeId,
        parentId,
        currentPath,
        depth
      );
    } else {
      return this.autoPlace(contentAtom.id, gist, treeId);
    }
  }

  /**
   * Process content with splitting logic (for large documents)
   */
  private async processContentWithSplitting(
      content: string,
      contentId: string,
      gist: string,
      treeId: string,
      parentId: string,
      currentPath: string,
      depth: number
  ): Promise<TreeNode> {

    const tree = await this.treeStore.getTree(treeId);
    const wordCount = content.split(/\s+/).length;

    const nodeId = randomUUID();
    const path = parentId ? `${currentPath}/${nodeId}` : `/${nodeId}`;

    await this.vectorStore.add(nodeId, `Gist: ${gist}\n${content.slice(0, 300)}`);

    let node: TreeNode = {
      id: nodeId,
      treeId,
      parentId,
      path,
      contentId,
      l0Gist: gist,
      l1Map: null,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // === HEURISTIC SPLIT STRATEGY ===
    if (wordCount > this.config.splitThreshold && depth < this.config.maxDepth) {

      // 1. Try Regex Split (Markdown Headers)
      let chunks = this.splitByRegex(content);
      let method = 'Regex';

      // 2. If Regex failed (1 chunk), try AI Split
      if (chunks.length <= 1) {
        chunks = await this.splitByAI(content);
        method = 'AI';
      }

      // 3. If AI failed, Hard Split
      if (chunks.length <= 1) {
        chunks = this.splitByLength(content, this.config.splitThreshold * 5); // ~characters
        method = 'Hard';
      }

      if (chunks.length > 1) {
        console.log(`   🔪 Splitting via ${method}: ${chunks.length} chunks`);

        const children: TreeNode[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const chunkId = `${contentId}-part-${i}`;

          await this.contentStore.create({
            payload: chunk,
            mediaType: 'text/plain',
            createdBy: 'system',
            customId: chunkId,
            metadata: { parentContentId: contentId, splitIndex: i, isDerivedChunk: true }
          });

          // Basic LLM for speed
          const chunkGistRaw = await this.basicLlm.complete(
              this.prompts.generateGist,
              { content: chunk, organizingPrinciple: tree.organizingPrinciple }
          );
          // Smart LLM for quality check
          const chunkGist = await this.sanctify(chunk, chunkGistRaw, treeId, 'L0');

          const child = await this.processContentWithSplitting(
              chunk, chunkId, chunkGist, treeId, nodeId, path, depth + 1
          );
          child.sortOrder = i;
          await this.treeStore.saveNode(child);
          children.push(child);
        }

        // Generate Map with Basic LLM
        const childGists = children.map(c => c.l0Gist);
        const rawL1Summary = await this.basicLlm.complete(
            this.prompts.generateL1,
            { parentGist: gist, childGists: childGists, organizingPrinciple: tree.organizingPrinciple }
        );
        // Inquisit Map with Smart LLM
        const l1Summary = await this.sanctify(childGists.join('\n'), rawL1Summary, treeId, 'L1');

        node.l1Map = {
          summary: l1Summary,
          childInventory: children.map(c => ({ nodeId: c.id, gist: c.l0Gist })),
          outboundRefs: [],
        };
      }
    }

    await this.treeStore.saveNode(node);
    await this.vectorStore.save(treeId);

    if (parentId) await this.bubbleUp(parentId);
    return node;
  }

  // --- SPLIT HELPERS ---

  private splitByRegex(content: string): string[] {
    // Matches Markdown headers (#, ##, ###)
    const regex = /^(#{1,3})\s+(.+)$/gm;
    const matches = [...content.matchAll(regex)];
    if (matches.length < 2) return [content];

    const chunks: string[] = [];

    // Capture preamble (text before first header)
    if (matches[0].index! > 0) {
      chunks.push(content.slice(0, matches[0].index).trim());
    }

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index!;
      const end = matches[i+1] ? matches[i+1].index! : content.length;
      const text = content.slice(start, end).trim();
      if (text.length > 0) chunks.push(text);
    }
    return chunks;
  }

  private async splitByAI(content: string): Promise<string[]> {
    // Only ask AI if content is manageable (< 50k chars)
    if (content.length > 50000) return [content];

    try {
      console.log(`      ... Attempting AI semantic split ...`);

      // First get suggestions (Basic LLM is enough for analyzing structure)
      const decisionJson = await this.basicLlm.complete(
          this.prompts.shouldSplit,
          { content, threshold: this.config.splitThreshold }
      );
      const { suggestedSections } = JSON.parse(decisionJson);

      if (!suggestedSections || suggestedSections.length < 2) return [content];

      // Ask for Anchors (smart LLM is necessary for generating JSON)
      const anchorsJson = await this.smartLlm.complete(
          this.prompts.findSplitAnchors,
          { content, sections: suggestedSections.join(', ') },
      );
      const { anchors } = JSON.parse(anchorsJson);

      return this.executeCuts(content, anchors);
    } catch (e) {
      return [content];
    }
  }

  private splitByLength(content: string, size: number): string[] {
    const chunks = [];
    for (let i = 0; i < content.length; i += size) {
      chunks.push(content.slice(i, i + size));
    }
    return chunks;
  }

  // Helper: The Knife
  private executeCuts(content: string, anchors: string[]): string[] {
    const chunks: string[] = [];
    let lastIndex = 0;

    // Sort anchors by position in text to ensure sequential cutting
    // Note: We scan from lastIndex to avoid duplicate phrases appearing earlier causing loops
    const sortedCutPoints: number[] = [];

    let searchCursor = 0;
    for (const anchor of anchors) {
        const idx = content.indexOf(anchor, searchCursor);
        if (idx !== -1) {
            sortedCutPoints.push(idx);
            // Move cursor forward, but allow some overlap if anchors are close?
            // Better to strictly move past the anchor.
            searchCursor = idx + 1;
        } else {
            console.warn(`   ⚠️  Anchor not found: "${anchor.slice(0, 20)}..."`);
        }
    }

    // If the first anchor isn't at 0, we have a "Pre-amble" chunk
    if (sortedCutPoints.length > 0 && sortedCutPoints[0] > 0) {
        // Option A: Treat 0->FirstAnchor as a chunk
        // Option B: Assume the first anchor was supposed to be the start
        // Let's go with Option A to be safe against data loss
        sortedCutPoints.unshift(0);
    }

    // Slice and Dice
    for (let i = 0; i < sortedCutPoints.length; i++) {
        const start = sortedCutPoints[i];
        const end = sortedCutPoints[i + 1] ?? content.length; // Defaults to end of string

        const text = content.slice(start, end).trim();
        if (text.length > 0) {
            chunks.push(text);
        }
    }

    // Fallback: If no anchors matched, return original
    if (chunks.length === 0) return [content];

    return chunks;
  }


  /**
   * INTELLIGENT AUTO-PLACEMENT
   * Uses LLM to recursively find the right spot in the tree hierarchy
   */
  async autoPlace(
    contentId: string,
    gist: string,
    treeId: string
  ): Promise<TreeNode> {
    const tree = await this.treeStore.getTree(treeId);

    let currentParentId = tree.rootNodeId;
    let currentParent = await this.treeStore.getNodeFromTree(treeId, currentParentId);

    if (!currentParent) {
      throw new Error(`Root node not found for tree: ${treeId}`);
    }

    const maxPlacementDepth = 3;
    let depth = 0;

    while (depth < maxPlacementDepth) {
      const children = await this.treeStore.getChildren(currentParentId);

      if (children.length === 0) {
        break;
      }

      const candidates = children.map(c => `- ${c.id}: ${c.l0Gist}`).join('\\n');

      try {
        const placementJson = await this.basicLlm.complete(
          this.prompts.placeInTree,
          {
            organizingPrinciple: tree.organizingPrinciple,
            placementStrategy: this.getPlacementStrategy(tree),
            gist,
            availableNodes: candidates || 'No existing categories',
          }
        );

        const decision = JSON.parse(placementJson);

        if (decision.parentNodeId && decision.parentNodeId !== currentParentId) {
          const nextNode = children.find(c => c.id === decision.parentNodeId);
          if (nextNode) {
            currentParentId = nextNode.id;
            currentParent = nextNode;
            depth++;
            continue;
          }
        }

        if (decision.createNodes && decision.createNodes.length > 0) {
          const categoryName = decision.createNodes[0];
          const categoryNode = await this.createOrganizationalNode(
            treeId,
            currentParentId,
            currentParent.path,
            categoryName
          );
          currentParentId = categoryNode.id;
          currentParent = categoryNode;
          break;
        }
        break;

      } catch (error) {
        console.error('Placement routing error:', error);
        break;
      }
    }

    const content = await this.contentStore.get(contentId);
    if (!content) {
      throw new Error(`Content not found: ${contentId}`);
    }

    return this.processContentWithSplitting(
      content.payload,
      contentId,
      gist,
      treeId,
      currentParentId,
      currentParent.path,
      0
    );
  }

  /**
   * Create an organizational node (container with no content)
   */
  private async createOrganizationalNode(
    treeId: string,
    parentId: string,
    parentPath: string,
    name: string
  ): Promise<TreeNode> {
    const id = `${parentId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const path = `${parentPath}/${id}`;

    const existing = await this.treeStore.getNodeFromTree(treeId, id);
    if (existing) {
      return existing;
    }

    const node: TreeNode = {
      id,
      treeId,
      parentId,
      path,
      contentId: null, // Organizational node
      l0Gist: name,
      l1Map: null,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Vectorize organizational nodes too (so we can find "Architecture" category)
    await this.vectorStore.add(id, `Category: ${name}`);

    await this.treeStore.saveNode(node);

    // Update parent's L1
    if (parentId) {
      await this.bubbleUp(parentId);
    }

    return node;
  }

  /**
   * Get placement strategy for a tree
   */
  private getPlacementStrategy(tree: TreeConfig | { organizingPrinciple: string; placementStrategy?: string }): string {
    if ('placementStrategy' in tree && tree.placementStrategy) {
      return tree.placementStrategy;
    }
    return 'Group by related topics and themes';
  }

  /**
   * SANCTIFY: The Inquisitor
   * Audits a generated summary against source content to detect heresy
   * (hallucinations, omissions, distortions, miscategorization)
   */
  private async sanctify(
    content: string,
    proposedSummary: string,
    treeId: string,
    summaryType: 'L0' | 'L1' = 'L0'
  ): Promise<string> {
    console.log(`\\n🔍 [The Inquisitor] Inspecting ${summaryType} for Tree: ${treeId}`);
    try {
      const tree = await this.treeStore.getTree(treeId);
      const contentSample = summaryType === 'L0' ? content.slice(0, 3000) : content;

      const heresyCheck = await this.smartLlm.complete(
        this.prompts.detectHeresy,
        {
          content: contentSample,
          summary: proposedSummary,
          organizingPrinciple: tree.organizingPrinciple,
        }
      );

      let verdict;
      try {
         verdict = JSON.parse(heresyCheck);
      } catch (parseError) {
         console.error(`💥 [Inquisitor] JSON Parse Failed!`);
         console.error(`   Raw LLM Output: "${heresyCheck}"`);
         return proposedSummary;
      }

      if (verdict.status === 'FAIL') {
        console.warn(`⚠️ [HERESY DETECTED] Reason: ${verdict.reason}`);
        if (verdict.correctedSummary) {
          console.log(`   ✨ Applying Correction`);
          return verdict.correctedSummary;
        }

        // Otherwise, log but allow the heresy (non-blocking for now)
        console.warn(`No correction provided, using original summary`);
        return proposedSummary;
      }

      console.log(`   ✅ PASS`);
      return proposedSummary;

    } catch (error) {
      console.error('   ❌ Inquisitor Malfunction:', error);
      return proposedSummary;
    }
  }

  /**
   * Bubble up: regenerate L1 summaries for a node based on its children
   */
  private async bubbleUp(nodeId: string): Promise<void> {
    const node = await this.treeStore.getNode(nodeId);
    if (!node) return;

    const children = await this.treeStore.getChildren(nodeId);
    if (children.length === 0) return;

    const tree = await this.treeStore.getTree(node.treeId);
    const childGists = children.map(c => c.l0Gist);

    try {
      const rawL1Summary = await this.basicLlm.complete(
        this.prompts.generateL1,
        {
          parentGist: node.l0Gist,
          childGists: childGists,
          organizingPrinciple: tree.organizingPrinciple,
        }
      );

      const childGistsText = childGists.join('\\n');
      const l1Summary = await this.sanctify(childGistsText, rawL1Summary, node.treeId, 'L1');

      node.l1Map = {
        summary: l1Summary,
        childInventory: children.map(c => ({ nodeId: c.id, gist: c.l0Gist })),
        outboundRefs: node.l1Map?.outboundRefs || [],
      };
      node.updatedAt = new Date().toISOString();

      // Update vector index for parent with new summary
      await this.vectorStore.add(node.id, `Category: ${node.l0Gist}\nSummary: ${l1Summary}`);
      await this.vectorStore.save(node.treeId);
      await this.treeStore.saveNode(node);
    } catch (error) {
      console.error('Failed to bubble up L1 summary:', error);
    }
  }

  /**
   * Regenerate summaries for a node and its ancestors
   */
  async regenerateSummaries(nodeId: string): Promise<void> {
    const node = await this.treeStore.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    await this.bubbleUp(nodeId);
    if (node.parentId) {
      await this.regenerateSummaries(node.parentId);
    }
  }
}
