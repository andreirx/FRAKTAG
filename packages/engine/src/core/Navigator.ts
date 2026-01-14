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

    console.log(`\n🧭 Starting Exploration in Tree: ${tree.name}`);
    console.log(`   Quest: "${request.query}"`);

    const navigationPath: string[] = [];
    const results: RetrievedNode[] = [];

    await this.explore(
        root,
        request.query,
        request.maxDepth ?? 5,
        request.resolution ?? 'L2',
        navigationPath,
        results,
        0
    );

    console.log(`\n🏁 Exploration Complete. Found ${results.length} relevant nodes.`);
    return { nodes: results, navigationPath };
  }

  private async explore(
      node: TreeNode,
      query: string,
      maxDepth: number,
      targetResolution: 'L0' | 'L1' | 'L2',
      navigationPath: string[],
      results: RetrievedNode[],
      depth: number
  ): Promise<void> {

    // 1. Scout: Is this node relevant?
    let relevant = false;
    let confidence = 0;

    // Optimization: Always explore Root
    if (depth === 0) {
      relevant = true;
      confidence = 1.0;
    } else {
      try {
        const scoutJson = await this.llm.complete(
            DEFAULT_PROMPTS.evaluateRelevance,
            { query, gist: node.l0Gist },
            { maxTokens: 512 }
        );
        const scout = JSON.parse(scoutJson);
        relevant = scout.relevant;
        confidence = scout.confidence;

        console.log(`   🔎 [Scout] Node: ${node.l0Gist.slice(0, 40)}... -> ${relevant ? 'REL' : 'SKIP'} (${confidence})`);
      } catch (e) {
        console.error("Scout failed", e);
        return; // Abort this branch
      }
    }

    if (!relevant || confidence < 0.4) return;

    navigationPath.push(node.id);

    // 2. Leaf or Dive?
    const children = await this.treeStore.getChildren(node.id);
    const isLeaf = children.length === 0;

    // If it's a leaf, OR we hit max depth, OR it's highly relevant and we want intermediate content
    if (isLeaf || depth >= maxDepth) {
      console.log(`   💎 Found Treasure: ${node.l0Gist.slice(0, 50)}...`);
      const content = await this.resolveContent(node, targetResolution);
      results.push({
        nodeId: node.id,
        path: node.path,
        resolution: targetResolution,
        content,
        contentId: node.contentId ?? undefined
      });
      return;
    }

    // 3. Router: Which children to visit?
    if (children.length > 0) {
      const candidates = children.map(c => `- ID: ${c.id}\n  Gist: ${c.l0Gist}`).join('\n');

      try {
        const routeJson = await this.llm.complete(
            DEFAULT_PROMPTS.routeTraversal,
            {
              query,
              parentGist: node.l0Gist,
              childrenList: candidates
            },
            { maxTokens: 1024 }
        );

        const route = JSON.parse(routeJson);
        const targets = route.targetChildIds || [];

        if (targets.length > 0) {
          console.log(`   👉 Routing to ${targets.length} children: ${route.reasoning?.slice(0, 50)}...`);

          // Parallel exploration? Maybe sequential for easier logging/debugging
          for (const targetId of targets) {
            const child = children.find(c => c.id === targetId);
            if (child) {
              await this.explore(child, query, maxDepth, targetResolution, navigationPath, results, depth + 1);
            }
          }
        } else {
          console.log(`   🛑 Dead End. No relevant children found.`);
        }

      } catch (e) {
        console.error("Router failed", e);
      }
    }
  }

  /**
   * Resolve content at the requested resolution level
   */
  private async resolveContent(node: TreeNode, resolution: 'L0' | 'L1' | 'L2'): Promise<string> {
    // ... existing logic ...
    switch (resolution) {
      case 'L0': return node.l0Gist;
      case 'L1': return node.l1Map?.summary ?? node.l0Gist;
      case 'L2':
        if (node.contentId) {
          const atom = await this.contentStore.get(node.contentId);
          return atom?.payload ?? node.l0Gist;
        }
        return node.l1Map?.summary ?? node.l0Gist;
    }
  }

  /**
   * Manual browsing of the tree structure
   */
  async browse(request: BrowseRequest): Promise<BrowseResult> {
    // ... existing logic ...
    const tree = await this.treeStore.getTree(request.treeId);
    const nodeId = request.nodeId ?? tree.rootNodeId;
    const node = await this.treeStore.getNodeFromTree(request.treeId, nodeId);
    if (!node) throw new Error("Node not found");

    const children = await this.treeStore.getChildren(nodeId);
    const parent = node.parentId ? await this.treeStore.getNode(node.parentId) : null;

    return {
      node: { id: node.id, path: node.path, gist: node.l0Gist, summary: request.resolution === 'L1' ? node.l1Map?.summary : undefined },
      children: children.map(c => ({ id: c.id, gist: c.l0Gist })),
      parent: parent ? { id: parent.id, gist: parent.l0Gist } : undefined
    };
  }
}
