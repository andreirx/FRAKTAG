// src/core/Fractalizer.ts

import { randomUUID } from 'crypto';
import { ContentStore } from './ContentStore.js';
import { TreeStore } from './TreeStore.js';
import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { TreeNode, IngestionConfig, PromptSet } from './types.js';

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
   * Ingest content into a tree, recursively splitting if needed
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
    const gist = await this.llm.complete(
      this.prompts.generateGist,
      { content, organizingPrinciple: tree.organizingPrinciple }
    );

    // 3. Check split decision
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
        // If LLM response is invalid, don't split
        console.error('Failed to parse split decision:', error);
        shouldSplit = false;
      }
    }

    // 4. Create node
    const nodeId = randomUUID();
    const path = parentId ? `${currentPath}/${nodeId}` : `/${nodeId}`;

    let node: TreeNode = {
      id: nodeId,
      treeId,
      parentId,
      path,
      contentId: contentAtom.id,
      l0Gist: gist,
      l1Map: null,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 5. Recurse if splitting
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
          const child = await this.ingest(chunk, treeId, nodeId, path, depth + 1);
          child.sortOrder = i;
          await this.treeStore.saveNode(child);
          children.push(child);
        }

        // 6. Bubble-up: generate L1 from children
        const childGists = children.map(c => c.l0Gist);
        const l1Summary = await this.llm.complete(
          this.prompts.generateL1,
          {
            parentGist: gist,
            childGists: childGists,
            organizingPrinciple: tree.organizingPrinciple,
          }
        );

        node.l1Map = {
          summary: l1Summary,
          childInventory: children.map(c => ({ nodeId: c.id, gist: c.l0Gist })),
          outboundRefs: [],
        };
      } catch (error) {
        // If splitting fails, keep as single node
        console.error('Failed to split content:', error);
      }
    }

    await this.treeStore.saveNode(node);

    // 7. Update parent's L1 if exists
    if (parentId) {
      await this.bubbleUp(parentId);
    }

    return node;
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
      const l1Summary = await this.llm.complete(
        this.prompts.generateL1,
        {
          parentGist: node.l0Gist,
          childGists: childGists,
          organizingPrinciple: tree.organizingPrinciple,
        }
      );

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

  /**
   * Auto-place content in a tree based on placement strategy
   */
  async autoPlace(
    contentId: string,
    gist: string,
    treeId: string
  ): Promise<TreeNode> {
    const tree = await this.treeStore.getTree(treeId);
    const rootNode = await this.treeStore.getNodeFromTree(treeId, tree.rootNodeId);

    if (!rootNode) {
      throw new Error(`Root node not found for tree: ${treeId}`);
    }

    // For now, place everything at root
    // In a full implementation, this would use LLM to determine placement
    const content = await this.contentStore.get(contentId);
    if (!content) {
      throw new Error(`Content not found: ${contentId}`);
    }

    const nodeId = randomUUID();
    const path = `${rootNode.path}${nodeId}`;

    const node: TreeNode = {
      id: nodeId,
      treeId,
      parentId: rootNode.id,
      path,
      contentId,
      l0Gist: gist,
      l1Map: null,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.treeStore.saveNode(node);

    // Update parent's L1
    await this.bubbleUp(rootNode.id);

    return node;
  }
}
