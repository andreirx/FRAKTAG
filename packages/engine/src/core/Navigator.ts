// packages/engine/src/core/Navigator.ts

import { ContentStore } from './ContentStore.js';
import { TreeStore } from './TreeStore.js';
import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { RetrieveRequest, RetrieveResult, RetrievedNode, BrowseRequest, BrowseResult, TreeNode } from './types.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';
import {VectorStore} from "./VectorStore.js";

export class Navigator {
  constructor(
      private contentStore: ContentStore,
      private treeStore: TreeStore,
      private vectorStore: VectorStore,
      private llm: ILLMAdapter
  ) {}

// Add VectorStore to constructor

  async retrieve(request: RetrieveRequest): Promise<RetrieveResult> {
    const tree = await this.treeStore.getTree(request.treeId);
    await this.vectorStore.load(request.treeId); // Load index

    console.log(`\n🔍 Phase 1: Vector Seeding (Naive RAG)`);
    // 1. Vector Search to find Entry Points
    const seeds = await this.vectorStore.search(request.query, 5); // Top 5 matches

    console.log(`   📍 Found ${seeds.length} seed nodes via embeddings.`);
    seeds.forEach(s => console.log(`      - [${s.score.toFixed(3)}] ${s.id}`));

    const results: RetrievedNode[] = [];
    const visited = new Set<string>();

    // 2. Graph Expansion (The "Agentic Loop")
    // Instead of starting at Root, we start at the Seeds.
    // BUT we also look at their PARENTS to understand context.

    for (const seed of seeds) {
      if (visited.has(seed.id)) continue;

      // Load the seed node
      const node = await this.treeStore.getNode(seed.id); // Note: getNode needs to be efficient
      if (!node) continue;

      console.log(`\n🧭 Exploring Seed Neighborhood: ${node.l0Gist.slice(0, 50)}...`);

      // Heuristic: If confidence is high, check this node.
      // Then, maybe check its parent to see if siblings are relevant?

      // Let's reuse the drill(), but start here.
      await this.drill(
          node,
          request.query,
          3, // Lower depth because we are already deep
          request.resolution || 'L2',
          results,
          visited,
          0, // "Local Depth"
          0,
          10
      );

      // OPTIONAL: Traverse UP?
      if (node.parentId) {
        console.log(`   ⬆️  Checking Parent Context...`);
        const parent = await this.treeStore.getNode(node.parentId);
        if (parent) {
// Inside retrieve() method

          // Check siblings via parent
          if (node.parentId) {
            console.log(`   ⬆️  Checking Parent Context...`);
            const parent = await this.treeStore.getNode(node.parentId);
            if (parent) {
              // FIX: Use || 'L2' to ensure it's never undefined
              await this.drill(
                  parent,
                  request.query,
                  1,
                  request.resolution || 'L2', // <--- FIX HERE
                  results,
                  visited,
                  0,
                  0,
                  10
              );
            }
          }
        }
      }
    }

    return { nodes: results, navigationPath: Array.from(visited) };
  }

  private async drill(
      node: TreeNode,
      query: string,
      maxDepth: number,
      targetResolution: 'L0' | 'L1' | 'L2',
      results: RetrievedNode[],
      visited: Set<string>,
      depth: number,
      orientationThreshold: number,
      totalTreeDepth: number
  ): Promise<void> {

    if (visited.has(node.id)) return;
    visited.add(node.id);

    // 1. GATHER CONTEXT
    const nodeContext = node.l1Map?.summary || node.l0Gist;
    const children = await this.treeStore.getChildren(node.id);
    const isLeaf = children.length === 0;

    // 2. EVALUATE RELEVANCE
    if (depth > 0) {
      await this.checkRelevance(node, nodeContext, query, targetResolution, results);
    }

    // 3. DECIDE TRAVERSAL
    // 3. DECIDE TRAVERSAL (The "Routing")
    // If leaf or max depth, stop.
    if (isLeaf || depth >= maxDepth) return;

    // Prepare Children List
    const candidates = children.map(c => {
      const context = c.l1Map?.summary
          ? `(Summary): ${c.l1Map.summary}...`
          : `(Gist): ${c.l0Gist}`;
      return `ID: ${c.id}\n${context}`;
    }).join('\n\n');
    console.log(`\n   📂 [Librarian] At "${node.l0Gist.slice(0, 30)}..." (Depth ${depth})`);

    // DYNAMIC PHASE CONTEXT
    const isOrientation = depth <= orientationThreshold;
    const phaseLabel = isOrientation
        ? "ORIENTATION Phase (Be Broad, route to general topic areas)"
        : "TARGETING Phase (Be Specific, look for direct matches)";

    const depthContext = `Current Depth: ${depth}/${totalTreeDepth}. Status: ${phaseLabel}.
    ${isOrientation ? "Instructions: Select ANY path that might conceptually contain the answer." : "Instructions: Select ONLY paths that likely contain the answer."}`;

    console.log(`\n   📂 [Librarian] At "${node.l0Gist.slice(0, 30)}..." (Depth ${depth})`);

    try {
      const response = await this.llm.complete(
          DEFAULT_PROMPTS.assessContainment,
          {
            query,
            parentContext: nodeContext,
            childrenList: candidates,
            depthContext // Inject the dynamic context
          },
          { maxTokens: 1024 }
      );

      const targetIds = response
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0 && !l.startsWith('Note:') && l !== 'NONE')
          .map(l => {
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
            await this.drill(child, query, maxDepth, targetResolution, results, visited, depth + 1, orientationThreshold, totalTreeDepth);
          }
        }
      } else {
        // Fallback: Force entry if only 1 child exists
        if (children.length === 1) {
          console.log(`   ⚠️  Librarian returned NONE, but only 1 path exists. Forcing entry.`);
          await this.drill(children[0], query, maxDepth, targetResolution, results, visited, depth + 1, orientationThreshold, totalTreeDepth);
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

      // INCREASED THRESHOLD for stricter "High Fidelity"
      if (score >= 8) {
        console.log(`   💎 Treasure Found! Score ${score}/10: "${node.l0Gist.slice(0, 40)}..."`);

        const content = await this.resolveContent(node, resolution);
        results.push({
          nodeId: node.id,
          path: node.path,
          resolution,
          content,
          contentId: node.contentId ?? undefined
        });
      }
    } catch (e) { }
  }

  /**
   * Resolve content at the requested resolution level
   */
  private async resolveContent(node: TreeNode, resolution: 'L0' | 'L1' | 'L2'): Promise<string> {
    switch (resolution) {
      case 'L0': return node.l0Gist;
      case 'L1': return node.l1Map?.summary ?? node.l0Gist;
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
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    const children = await this.treeStore.getChildren(nodeId);
    const parent = node.parentId ? await this.treeStore.getNode(node.parentId) : null;
    return {
      node: { id: node.id, path: node.path, gist: node.l0Gist, summary: request.resolution === 'L1' ? node.l1Map?.summary : undefined },
      children: children.map(c => ({ id: c.id, gist: c.l0Gist })),
      parent: parent ? { id: parent.id, gist: parent.l0Gist } : undefined
    };
  }
}
