// packages/engine/src/core/Navigator.ts

import { ContentStore } from './ContentStore.js';
import { TreeStore } from './TreeStore.js';
import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { RetrieveRequest, RetrieveResult, RetrievedNode, BrowseRequest, BrowseResult, TreeNode } from './types.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';

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

    if (!root) throw new Error(`Root node not found for tree: ${request.treeId}`);

    console.log(`\n🧭 Starting Hierarchical Drill in Tree: ${tree.name}`);
    console.log(`   Quest: "${request.query}"`);

    const navigationPath: string[] = [];
    const results: RetrievedNode[] = [];
    const visited = new Set<string>();

    await this.drill(
        root,
        request.query,
        request.maxDepth ?? 5,
        request.resolution ?? 'L2',
        results,
        visited,
        0
    );

    console.log(`\n🏁 Exploration Complete. Found ${results.length} relevant nodes.`);
    return { nodes: results, navigationPath: Array.from(visited) };
  }

  private async drill(
      node: TreeNode,
      query: string,
      maxDepth: number,
      targetResolution: 'L0' | 'L1' | 'L2',
      results: RetrievedNode[],
      visited: Set<string>,
      depth: number
  ): Promise<void> {

    if (visited.has(node.id)) return;
    visited.add(node.id);

    // 1. GATHER CONTEXT
    // Use L1 summary if available (it's richer), otherwise L0 Gist
    const nodeContext = node.l1Map?.summary || node.l0Gist;
    const children = await this.treeStore.getChildren(node.id);
    const isLeaf = children.length === 0;

    // 2. EVALUATE RELEVANCE (The "Treasure Check")
    // We check every node we visit. Is THIS node the answer?
    // Optimization: Skip Root relevance check usually, it's too broad.
    if (depth > 0) {
      await this.checkRelevance(node, nodeContext, query, targetResolution, results);
    }

    // 3. DECIDE TRAVERSAL (The "Routing")
    // If leaf or max depth, stop.
    if (isLeaf || depth >= maxDepth) return;

    // Prepare Children List for the Librarian
    const candidates = children.map(c => `ID: ${c.id}\nLabel: ${c.l0Gist}`).join('\n\n');

    console.log(`\n   📂 [Librarian] At "${node.l0Gist.slice(0, 30)}..." with ${children.length} paths.`);

    try {
      const response = await this.llm.complete(
          DEFAULT_PROMPTS.assessContainment,
          {
            query,
            parentContext: nodeContext.slice(0, 500), // Give context to the librarian
            childrenList: candidates
          },
          { maxTokens: 512 }
      );

      // Parse Line-Delimited IDs
      const targetIds = response
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0 && !l.startsWith('Note:') && l !== 'NONE')
          .map(l => {
            // Fuzzy match ID in line
            const match = children.find(c => l.includes(c.id));
            return match ? match.id : null;
          })
          .filter((id): id is string => id !== null);

      const uniqueTargets = [...new Set(targetIds)];

      if (uniqueTargets.length > 0) {
        console.log(`   👉 Selected ${uniqueTargets.length} paths to dive.`);
        for (const targetId of uniqueTargets) {
          const child = children.find(c => c.id === targetId);
          if (child) {
            await this.drill(child, query, maxDepth, targetResolution, results, visited, depth + 1);
          }
        }
      } else {
        // Fallback: If only 1 child exists, just go there. Don't let the LLM be lazy.
        if (children.length === 1) {
          console.log(`   ⚠️  Librarian returned NONE, but only 1 path exists. Forcing entry.`);
          await this.drill(children[0], query, maxDepth, targetResolution, results, visited, depth + 1);
        } else {
          console.log(`   🛑 Dead End. Librarian sees no relevant paths.`);
        }
      }

    } catch (e) {
      console.error("   ❌ Routing Error", e);
    }
  }

  private async checkRelevance(
      node: TreeNode,
      context: string,
      query: string,
      resolution: 'L0' | 'L1' | 'L2',
      results: RetrievedNode[]
  ) {
    try {
      const response = await this.llm.complete(
          DEFAULT_PROMPTS.assessRelevance,
          { query, content: context },
          { maxTokens: 128 }
      );

      const match = response.match(/(\d+)\s*\|/);
      const score = match ? parseInt(match[1]) : 0;

      if (score >= 6) { // Threshold: 6/10
        console.log(`   💎 Treasure Found! Score ${score}/10: "${node.l0Gist.slice(0, 40)}..."`);

        // If very relevant, fetch full content
        const content = await this.resolveContent(node, resolution);
        results.push({
          nodeId: node.id,
          path: node.path,
          resolution,
          content,
          contentId: node.contentId ?? undefined
        });
      }
    } catch (e) {
      // Ignore failures here, just don't add result
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
