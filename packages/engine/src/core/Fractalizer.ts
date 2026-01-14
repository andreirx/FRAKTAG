// src/core/Fractalizer.ts

import { randomUUID } from 'crypto';
import { ContentStore } from './ContentStore.js';
import { TreeStore } from './TreeStore.js';
import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { TreeNode, IngestionConfig, PromptSet, TreeConfig } from './types.js';

/**
 * Fractalizer handles content ingestion: splitting, summarizing, and bubble-up
 */
export class Fractalizer {
  constructor(
    private contentStore: ContentStore,
    private treeStore: TreeStore,
    private llm: ILLMAdapter,
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

    // 1. Store content atom
    const contentAtom = await this.contentStore.create({
      payload: content,
      mediaType: 'text/plain',
      createdBy: 'system',
    });

    // 2. Generate gist
    const tree = await this.treeStore.getTree(treeId);
    const rawGist = await this.llm.complete(
      this.prompts.generateGist,
      { content, organizingPrinciple: tree.organizingPrinciple }
    );

    // 2.5. The Inquisition - audit gist for accuracy
    const gist = await this.sanctify(content, rawGist, treeId, 'L0');

    // 3. Route based on whether parent is specified
    if (parentId) {
      // Direct placement with potential splitting
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
      // Auto-placement (intelligent sorting)
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

    // Check split decision
    const wordCount = content.split(/\s+/).length;
    let shouldSplit = false;
    let sections: string[] = [];

    if (wordCount > this.config.splitThreshold && depth < this.config.maxDepth) {
      try {
        const decision = await this.llm.complete(
          this.prompts.shouldSplit,
          { content, threshold: this.config.splitThreshold }
        );
        const parsed = JSON.parse(decision);
        shouldSplit = parsed.split;
        sections = parsed.suggestedSections || [];
      } catch (error) {
        console.error('Failed to parse split decision:', error);
        shouldSplit = false;
      }
    }

    // Create node
    const nodeId = randomUUID();
    const path = parentId ? `${currentPath}/${nodeId}` : `/${nodeId}`;

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

    // Recurse if splitting
    if (shouldSplit && sections.length > 0) {
      try {
        const chunksResponse = await this.llm.complete(
          this.prompts.split,
          { content, sections: sections.join(', ') }
        );
        const parsedChunks: string[] = JSON.parse(chunksResponse);

        const children: TreeNode[] = [];
        for (let i = 0; i < parsedChunks.length; i++) {
          const chunk = parsedChunks[i];
          const child = await this.processContentWithSplitting(
            chunk,
            contentId,
            gist,
            treeId,
            nodeId,
            path,
            depth + 1
          );
          child.sortOrder = i;
          await this.treeStore.saveNode(child);
          children.push(child);
        }

        // Bubble-up: generate L1 from children
        const childGists = children.map(c => c.l0Gist);
        const rawL1Summary = await this.llm.complete(
          this.prompts.generateL1,
          {
            parentGist: gist,
            childGists: childGists,
            organizingPrinciple: tree.organizingPrinciple,
          }
        );

        // The Inquisition - audit L1 summary
        const childGistsText = childGists.join('\n');
        const l1Summary = await this.sanctify(childGistsText, rawL1Summary, treeId, 'L1');

        node.l1Map = {
          summary: l1Summary,
          childInventory: children.map(c => ({ nodeId: c.id, gist: c.l0Gist })),
          outboundRefs: [],
        };
      } catch (error) {
        console.error('Failed to split content:', error);
      }
    }

    await this.treeStore.saveNode(node);

    // Update parent's L1 if exists
    if (parentId) {
      await this.bubbleUp(parentId);
    }

    return node;
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

    // Start at root
    let currentParentId = tree.rootNodeId;
    let currentParent = await this.treeStore.getNodeFromTree(treeId, currentParentId);

    if (!currentParent) {
      throw new Error(`Root node not found for tree: ${treeId}`);
    }

    const maxPlacementDepth = 3; // Don't auto-sort too deep
    let depth = 0;

    // Recursive routing to find the right spot
    while (depth < maxPlacementDepth) {
      const children = await this.treeStore.getChildren(currentParentId);

      // If no children, place here
      if (children.length === 0) {
        break;
      }

      // Ask LLM where to route
      const candidates = children.map(c => `- ${c.id}: ${c.l0Gist}`).join('\n');

      try {
        const placementJson = await this.llm.complete(
          this.prompts.placeInTree,
          {
            organizingPrinciple: tree.organizingPrinciple,
            placementStrategy: this.getPlacementStrategy(tree),
            gist,
            availableNodes: candidates || 'No existing categories',
          }
        );

        const decision = JSON.parse(placementJson);

        // Case A: Place in existing child -> recurse down
        if (decision.parentNodeId && decision.parentNodeId !== currentParentId) {
          const nextNode = children.find(c => c.id === decision.parentNodeId);
          if (nextNode) {
            currentParentId = nextNode.id;
            currentParent = nextNode;
            depth++;
            continue;
          }
        }

        // Case B: Create new category container
        if (decision.createNodes && decision.createNodes.length > 0) {
          const categoryName = decision.createNodes[0];
          const categoryNode = await this.createOrganizationalNode(
            treeId,
            currentParentId,
            currentParent.path,
            categoryName
          );

          // Place content inside this new category
          currentParentId = categoryNode.id;
          currentParent = categoryNode;
          break;
        }

        // Case C: Place at current level
        break;

      } catch (error) {
        console.error('Placement routing error:', error);
        break;
      }
    }

    // Final placement: create the content node
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
    // Generate a clean ID from the name
    const id = `${parentId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const path = `${parentPath}/${id}`;

    // Check if it already exists
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
    try {
      const tree = await this.treeStore.getTree(treeId);

      // Optimization: For very large content, sample first 3000 chars
      // L1 summaries are compared against child gists, not full content
      const contentSample = summaryType === 'L0'
        ? content.slice(0, 3000)
        : content; // For L1, content is already the concatenated child gists

      const heresyCheck = await this.llm.complete(
        this.prompts.detectHeresy,
        {
          content: contentSample,
          summary: proposedSummary,
          organizingPrinciple: tree.organizingPrinciple,
        }
      );

      const verdict = JSON.parse(heresyCheck);

      if (verdict.status === 'FAIL') {
        console.warn(`[HERESY DETECTED] Tree: ${treeId}, Type: ${summaryType}`);
        console.warn(`Reason: ${verdict.reason}`);

        // If the Inquisitor provided a correction, use it
        if (verdict.correctedSummary) {
          console.warn(`Using corrected summary`);
          return verdict.correctedSummary;
        }

        // Otherwise, log but allow the heresy (non-blocking for now)
        console.warn(`No correction provided, using original summary`);
        return proposedSummary;
      }

      // Passed the Inquisition
      return proposedSummary;

    } catch (error) {
      // If the Inquisitor fails, log and pass through
      console.error('Inquisitor malfunction:', error);
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
      const rawL1Summary = await this.llm.complete(
        this.prompts.generateL1,
        {
          parentGist: node.l0Gist,
          childGists: childGists,
          organizingPrinciple: tree.organizingPrinciple,
        }
      );

      // The Inquisition - audit L1 summary during bubble-up
      const childGistsText = childGists.join('\n');
      const l1Summary = await this.sanctify(childGistsText, rawL1Summary, node.treeId, 'L1');

      node.l1Map = {
        summary: l1Summary,
        childInventory: children.map(c => ({ nodeId: c.id, gist: c.l0Gist })),
        outboundRefs: node.l1Map?.outboundRefs || [],
      };
      node.updatedAt = new Date().toISOString();

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

    // Regenerate this node's L1
    await this.bubbleUp(nodeId);

    // Propagate up to parent
    if (node.parentId) {
      await this.regenerateSummaries(node.parentId);
    }
  }
}
