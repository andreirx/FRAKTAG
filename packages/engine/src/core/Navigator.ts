// packages/engine/src/core/Navigator.ts

import { ContentStore } from './ContentStore.js';
import { TreeStore } from './TreeStore.js';
import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { VectorStore } from './VectorStore.js';
import { RetrieveRequest, RetrieveResult, RetrievedNode, BrowseRequest, BrowseResult, TreeNode } from './types.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';

export class Navigator {
  constructor(
      private contentStore: ContentStore,
      private treeStore: TreeStore,
      private vectorStore: VectorStore,
      private llm: ILLMAdapter
  ) {}

  async retrieve(request: RetrieveRequest): Promise<RetrieveResult> {
    const tree = await this.treeStore.getTree(request.treeId);
    await this.vectorStore.load(request.treeId);

    console.log(`\n🧭 Starting Retrieval: ${tree.name}`);
    console.log(`   Quest: "${request.query}"`);

    const results: RetrievedNode[] = [];
    const visited = new Set<string>();
    const candidates = new Set<string>(); // IDs to drill into

    // === PHASE 1: VECTOR SEEDING (The Math) ===
    console.log(`\n🔍 [Phase 1] Vector Seeding`);
    const seeds = await this.vectorStore.search(request.query, 5);
    seeds.filter(s => s.score > 0.25).forEach(s => candidates.add(s.id));
    console.log(`   📍 Vectors found ${candidates.size} candidates.`);

    // === PHASE 2: GLOBAL MAP SCAN (The "First Glance") ===
    console.log(`\n🔍 [Phase 2] Global Map Scan`);
    const treeMap = await this.treeStore.generateTreeMap(request.treeId);

    // Safety Check: If tree is massive (>100k chars), maybe truncate?
    // For 20-50 files, it's fine.

    try {
      const scanJson = await this.llm.complete(
          DEFAULT_PROMPTS.globalMapScan,
          { query: request.query, treeMap },
          { maxTokens: 1024 }
      );
      const scan = JSON.parse(scanJson);
      const mapTargets = scan.targetIds || [];

      console.log(`   🗺️  Strategist identified ${mapTargets.length} targets.`);
      mapTargets.forEach((id: string) => candidates.add(id));

    } catch (e) {
      console.error("   ❌ Map Scan failed:", e);
      // Fallback: Add Root to candidates to force a top-down crawl if map fails?
      // candidates.add(tree.rootNodeId);
    }

    // === PHASE 3: PRECISION DRILLING ===
    console.log(`\n🔍 [Phase 3] Investigating ${candidates.size} Candidates`);

    for (const id of candidates) {
      if (visited.has(id)) continue;
      const node = await this.treeStore.getNode(id);
      if (!node) continue;

      console.log(`   🪂 Dive: ${node.l0Gist.slice(0, 50)}...`);

      // We check the candidate itself
      await this.drill(
          node, request.query,
          2, // Low depth recursion (we assume the Map/Vector got us close)
          request.resolution || 'L2',
          results, visited,
          0, 0, 10,
          true // Force Relevance Check
      );

      // Optional: Check Parent Context for candidates
      if (node.parentId) {
        const parent = await this.treeStore.getNode(node.parentId);
        if (parent && !visited.has(parent.id)) {
          // Quick check on parent to see if siblings are relevant
          await this.drill(parent, request.query, 1, request.resolution || 'L2', results, visited, 0, 0, 10, false);
        }
      }
    }

    const uniqueResults = Array.from(new Map(results.map(item => [item.nodeId, item])).values());
    console.log(`\n🏁 Exploration Complete. Found ${uniqueResults.length} relevant nodes.`);
    return { nodes: uniqueResults, navigationPath: Array.from(visited) };
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
      totalTreeDepth: number,
      forceCheck: boolean = false
  ): Promise<void> {

    if (visited.has(node.id)) return;
    visited.add(node.id);

    // 1. GATHER CONTEXT
    const nodeContext = node.l1Map?.summary || node.l0Gist;
    const children = await this.treeStore.getChildren(node.id);
    const isLeaf = children.length === 0;

    // 2. EVALUATE RELEVANCE (THE MAGNET)
    // FIX: Check if forceCheck is true OR if depth > 0 OR if it's a Leaf
    // We usually skip the absolute Root (depth 0) unless forced (Seed)
    if (depth > 0 || forceCheck || isLeaf) {
      await this.checkRelevance(node, nodeContext, query, targetResolution, results);
    }

    // 3. DECIDE TRAVERSAL (THE ROUTER)
    if (isLeaf || depth >= maxDepth) return;

    // Prepare Children List
    const candidates = children.map(c => {
      const context = c.l1Map?.summary
          ? `(Summary): ${c.l1Map.summary.slice(0, 150)}...`
          : `(Gist): ${c.l0Gist}`;
      return `ID: ${c.id}\n${context}`;
    }).join('\n\n');

    // DYNAMIC PHASE CONTEXT
    const isOrientation = depth <= orientationThreshold;
    const phaseLabel = isOrientation
        ? "ORIENTATION Phase (Be Broad, route to general topic areas)"
        : "TARGETING Phase (Be Specific, look for direct matches)";

    const depthContext = `Current Depth: ${depth}/${totalTreeDepth}. Status: ${phaseLabel}.`;

    console.log(`   📂 [Librarian] At "${node.l0Gist.slice(0, 30)}..." (Depth ${depth})`);

    try {
      const response = await this.llm.complete(
          DEFAULT_PROMPTS.assessContainment,
          {
            query,
            parentContext: nodeContext,
            childrenList: candidates,
            depthContext
          },
          { maxTokens: 1024 }
      );

      const targetIds = response
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0 && !l.startsWith('Note:') && l !== 'NONE')
          .map(l => {
            // Fuzzy match ID in case LLM hallucinates whitespace/quotes
            const match = children.find(c => l.includes(c.id));
            return match ? match.id : null;
          })
          .filter((id): id is string => id !== null);

      const uniqueTargets = [...new Set(targetIds)];

      if (uniqueTargets.length > 0) {
        console.log(`      👉 Selected ${uniqueTargets.length} paths.`);
        for (const targetId of uniqueTargets) {
          const child = children.find(c => c.id === targetId);
          if (child) {
            await this.drill(
                child, query, maxDepth, targetResolution,
                results, visited, depth + 1, orientationThreshold, totalTreeDepth, false
            );
          }
        }
      } else {
        // Dead End Logic
        if (children.length === 1 && !isOrientation) {
          // If there's only one way forward and we aren't in broad mode, take it.
          await this.drill(children[0], query, maxDepth, targetResolution, results, visited, depth + 1, orientationThreshold, totalTreeDepth, false);
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

      if (score >= 7) { // Tuned: 7+ is relevant. 8+ was too strict for summaries.
        console.log(`      💎 Treasure Found! Score ${score}/10: "${node.l0Gist.slice(0, 100)}..."`);

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
