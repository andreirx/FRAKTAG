// src/core/Navigator.ts

import { ContentStore } from './ContentStore.js';
import { TreeStore } from './TreeStore.js';
import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import {
  RetrieveRequest,
  RetrieveResult,
  RetrievedNode,
  BrowseRequest,
  BrowseResult,
  TreeNode,
} from './types.js';

/**
 * Navigator handles retrieval through zoom traversal
 */
export class Navigator {
  constructor(
    private contentStore: ContentStore,
    private treeStore: TreeStore,
    private llm: ILLMAdapter
  ) {}

  /**
   * Query-driven retrieval using zoom traversal
   */
  async retrieve(request: RetrieveRequest): Promise<RetrieveResult> {
    const tree = await this.treeStore.getTree(request.treeId);
    const root = await this.treeStore.getNodeFromTree(request.treeId, tree.rootNodeId);

    if (!root) {
      throw new Error(`Root node not found for tree: ${request.treeId}`);
    }

    const navigationPath: string[] = [];
    const results: RetrievedNode[] = [];

    await this.zoom(
      root,
      request.query,
      request.maxDepth ?? 10,
      request.resolution ?? 'L2',
      navigationPath,
      results,
      0
    );

    return { nodes: results, navigationPath };
  }

  /**
   * Recursive zoom traversal
   */
  private async zoom(
    node: TreeNode,
    query: string,
    maxDepth: number,
    targetResolution: 'L0' | 'L1' | 'L2',
    navigationPath: string[],
    results: RetrievedNode[],
    depth: number
  ): Promise<void> {

    navigationPath.push(node.id);

    // Check if this node is relevant
    let relevant = false;
    let confidence = 0;

    try {
      const relevanceCheck = await this.llm.complete(
        `Given the query "${query}", is this content relevant?\n\nGist: ${node.l0Gist}\n\nRespond with JSON: {"relevant": boolean, "confidence": number}`,
        {}
      );
      const parsed = JSON.parse(relevanceCheck);
      relevant = parsed.relevant;
      confidence = parsed.confidence;
    } catch (error) {
      // If LLM fails, assume not relevant
      console.error('Failed to check relevance:', error);
      navigationPath.pop();
      return;
    }

    if (!relevant || confidence < 0.5) {
      navigationPath.pop();
      return;
    }

    // If leaf node or max depth reached, collect result
    const children = await this.treeStore.getChildren(node.id);

    if (children.length === 0 || depth >= maxDepth) {
      const content = await this.resolveContent(node, targetResolution);
      results.push({
        nodeId: node.id,
        path: node.path,
        resolution: targetResolution,
        content,
        contentId: node.contentId ?? undefined,
      });
      return;
    }

    // Navigate to relevant children using L1 map
    if (node.l1Map && children.length > 0) {
      try {
        const routingPrompt = `
Query: "${query}"

Available children:
${node.l1Map.childInventory.map(c => `- ${c.nodeId}: ${c.gist}`).join('\n')}

Which children should be explored? Return JSON: {"childIds": ["id1", "id2"]}
        `;

        const routing = await this.llm.complete(routingPrompt, {});
        const { childIds } = JSON.parse(routing);

        for (const childId of childIds) {
          const child = children.find(c => c.id === childId);
          if (child) {
            await this.zoom(child, query, maxDepth, targetResolution, navigationPath, results, depth + 1);
          }
        }
      } catch (error) {
        // If routing fails, explore all children
        console.error('Failed to route to children:', error);
        for (const child of children) {
          await this.zoom(child, query, maxDepth, targetResolution, navigationPath, results, depth + 1);
        }
      }
    } else {
      // No L1 map, collect this node as result
      const content = await this.resolveContent(node, targetResolution);
      results.push({
        nodeId: node.id,
        path: node.path,
        resolution: targetResolution,
        content,
        contentId: node.contentId ?? undefined,
      });
    }
  }

  /**
   * Resolve content at the requested resolution level
   */
  private async resolveContent(node: TreeNode, resolution: 'L0' | 'L1' | 'L2'): Promise<string> {
    switch (resolution) {
      case 'L0':
        return node.l0Gist;
      case 'L1':
        return node.l1Map?.summary ?? node.l0Gist;
      case 'L2':
        if (node.contentId) {
          const content = await this.contentStore.get(node.contentId);
          return content?.payload ?? node.l0Gist;
        }
        return node.l1Map?.summary ?? node.l0Gist;
    }
  }

  /**
   * Manual browsing of the tree structure
   */
  async browse(request: BrowseRequest): Promise<BrowseResult> {
    const tree = await this.treeStore.getTree(request.treeId);
    const nodeId = request.nodeId ?? tree.rootNodeId;
    const node = await this.treeStore.getNodeFromTree(request.treeId, nodeId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const children = await this.treeStore.getChildren(nodeId);
    const parent = node.parentId
      ? await this.treeStore.getNode(node.parentId)
      : null;

    return {
      node: {
        id: node.id,
        path: node.path,
        gist: node.l0Gist,
        summary: request.resolution === 'L1' ? node.l1Map?.summary : undefined,
      },
      children: children.map(c => ({
        id: c.id,
        gist: c.l0Gist,
      })),
      parent: parent ? {
        id: parent.id,
        gist: parent.l0Gist,
      } : undefined,
    };
  }
}
