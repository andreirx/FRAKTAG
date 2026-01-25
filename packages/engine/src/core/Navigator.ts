// packages/engine/src/core/Navigator.ts
// RETRIEVAL ENGINE - Updated for Strict Taxonomy

import { ContentStore } from './ContentStore.js';
import { TreeStore } from './TreeStore.js';
import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { VectorStore } from './VectorStore.js';
import {
  RetrieveRequest,
  RetrieveResult,
  RetrievedNode,
  BrowseRequest,
  BrowseResult,
  TreeNode,
  isFolder,
  hasContent
} from './types.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';

/**
 * Store resolver interface for KB-aware operations
 */
export interface StoreResolver {
  getTreeStoreForTree(treeId: string): TreeStore;
  getContentStoreForTree(treeId: string): ContentStore;
  getVectorStoreForTree(treeId: string): VectorStore;
}

export class Navigator {
  private storeResolver?: StoreResolver;

  constructor(
    private contentStore: ContentStore,
    private treeStore: TreeStore,
    private vectorStore: VectorStore,
    private llm: ILLMAdapter
  ) {}

  /**
   * Set a store resolver for KB-aware operations.
   * When set, the Navigator will use the resolver to get the correct stores for each tree.
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

  async retrieve(request: RetrieveRequest): Promise<RetrieveResult> {
    // Get the correct stores for this tree (KB-aware routing)
    const treeStore = this.getTreeStore(request.treeId);
    const vectorStore = this.getVectorStore(request.treeId);

    const tree = await treeStore.getTree(request.treeId);
    await vectorStore.load(request.treeId);

    console.log(`\n🧭 Starting Retrieval: ${tree.name}`);
    console.log(`   Quest: "${request.query}"`);

    const results: RetrievedNode[] = [];
    const visited = new Set<string>();
    const candidates = new Set<string>();

    // =========================================================
    // PHASE 1: VECTOR BATCH RECONNAISSANCE
    // =========================================================
    console.log(`\n🔍 [Phase 1] Vector Neighborhood Scan`);
    const seeds = await vectorStore.search(request.query, 5);
    const validSeeds = seeds.filter(s => s.score > 0.25);

    if (validSeeds.length > 0) {
      const neighborhoodText = await this.buildNeighborhoodContext(validSeeds, request.treeId);

      try {
        const decisionJson = await this.llm.complete(
          DEFAULT_PROMPTS.assessVectorCandidates,
          { query: request.query, neighborhoods: neighborhoodText },
          { maxTokens: 1024 }
        );

        const decision = JSON.parse(decisionJson);
        const targetIds = decision.relevantNodeIds || [];

        console.log(`   Scout selected ${targetIds.length} nodes from vectors.`);

        for (const id of targetIds) {
          if (visited.has(id)) continue;

          const node = await treeStore.getNode(id);
          if (node) {
            visited.add(id);

            // Document or Fragment: Grab content directly
            if (hasContent(node)) {
              console.log(`      💎 Captured ${node.type}: "${node.title.slice(0, 50)}..."`);
              const content = await this.resolveContent(node, request.resolution || 'L2');
              results.push({
                nodeId: node.id,
                path: node.path,
                resolution: request.resolution || 'L2',
                content,
                contentId: node.contentId
              });
            } else {
              // Folder: Queue for drilling
              visited.delete(id);
              candidates.add(id);
              console.log(`      📂 Queueing Folder: "${node.title.slice(0, 50)}..."`);
            }
          }
        }
      } catch (e) {
        console.error("   ❌ Vector Batch Scan failed:", e);
      }
    }

    // =========================================================
    // PHASE 2: GLOBAL MAP SCAN
    // =========================================================
    console.log(`\n🔍 [Phase 2] Global Map Scan`);
    const fullTreeMap = await treeStore.generateTreeMap(request.treeId);

    const CHUNK_SIZE = 200000;
    const OVERLAP = 1000;
    const mapChunks = this.chunkText(fullTreeMap, CHUNK_SIZE, OVERLAP);

    if (mapChunks.length > 1) {
      console.log(`   Map too large (${fullTreeMap.length} chars). Split into ${mapChunks.length} chunks.`);
    }

    const scanPromises = mapChunks.map(async (chunk, index) => {
      try {
        const partialContext = mapChunks.length > 1
          ? `(Part ${index + 1} of ${mapChunks.length})`
          : "";

        const scanJson = await this.llm.complete(
          DEFAULT_PROMPTS.globalMapScan,
          {
            query: request.query,
            treeMap: `[Map Segment ${partialContext}]\n${chunk}`
          },
          { maxTokens: 1024 }
        );

        const scan = JSON.parse(scanJson);
        return scan.targetIds || [];
      } catch (e) {
        console.error(`   ❌ Map Scan failed for chunk ${index + 1}:`, e);
        return [];
      }
    });

    const allTargets = (await Promise.all(scanPromises)).flat();
    const uniqueTargets = [...new Set(allTargets)];
    console.log(`   Strategist identified ${uniqueTargets.length} targets from map scan.`);
    uniqueTargets.forEach((id: string) => candidates.add(id));

    // =========================================================
    // PHASE 3: PRECISION DRILLING
    // =========================================================
    console.log(`\n🔍 [Phase 3] Investigating ${candidates.size} Candidates`);

    for (const id of candidates) {
      if (visited.has(id)) continue;
      const node = await treeStore.getNode(id);
      if (!node) continue;

      console.log(`   🪂 Dive: ${node.title.slice(0, 50)}...`);

      await this.drill(
        node,
        request.query,
        2,
        request.resolution || 'L2',
        results,
        visited,
        0,
        0,
        10,
        true,
        request.treeId
      );

      // Check parent context
      if (node.parentId) {
        const parent = await treeStore.getNode(node.parentId);
        if (parent && !visited.has(parent.id)) {
          await this.drill(parent, request.query, 1, request.resolution || 'L2', results, visited, 0, 0, 10, false, request.treeId);
        }
      }
    }

    const uniqueResults = Array.from(new Map(results.map(item => [item.nodeId, item])).values());
    console.log(`\n🏁 Exploration Complete. Found ${uniqueResults.length} relevant nodes.`);
    return { nodes: uniqueResults, navigationPath: Array.from(visited) };
  }

  private async buildNeighborhoodContext(seeds: { id: string; score: number }[], treeId: string): Promise<string> {
    // Get the correct tree store for KB-aware routing
    const treeStore = this.getTreeStore(treeId);
    let output = "";

    for (const seed of seeds) {
      const node = await treeStore.getNode(seed.id);
      if (!node) continue;

      output += `\n=== NEIGHBORHOOD (Score: ${seed.score.toFixed(2)}) ===\n`;

      // Parent Context
      if (node.parentId) {
        const parent = await treeStore.getNode(node.parentId);
        if (parent) {
          output += `PARENT [${parent.id}] (${parent.type}): ${parent.title} - ${parent.gist}\n`;
        }
      }

      // The Node Itself
      output += `>> FOCUS NODE [${node.id}] (${node.type}): ${node.title}\n`;
      output += `   Gist: ${node.gist.slice(0, 200)}...\n`;

      // Children
      const children = await treeStore.getChildren(node.id);
      if (children.length > 0) {
        output += `   CHILDREN:\n`;
        children.forEach(c => {
          output += `   - [${c.id}] (${c.type}): ${c.title}\n`;
        });
      }
    }
    return output;
  }

  private chunkText(text: string, size: number, overlap: number): string[] {
    if (text.length <= size) return [text];

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + size;

      if (end < text.length) {
        const lastNewline = text.lastIndexOf('\n', end);
        if (lastNewline > start) {
          end = lastNewline;
        }
      }

      chunks.push(text.slice(start, end));
      start = end - overlap;
      if (start >= end) start = end;
    }

    return chunks;
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
    forceCheck: boolean = false,
    treeId?: string
  ): Promise<void> {
    // Get the correct tree store for KB-aware routing
    const effectiveTreeId = treeId || node.treeId;
    const treeStore = this.getTreeStore(effectiveTreeId);
    const contentStore = this.getContentStore(effectiveTreeId);

    if (visited.has(node.id)) return;
    visited.add(node.id);

    // If this node has content, grab it
    if (hasContent(node)) {
      const content = await this.resolveContent(node, targetResolution, effectiveTreeId);
      results.push({
        nodeId: node.id,
        path: node.path,
        resolution: targetResolution,
        content,
        contentId: node.contentId
      });
      console.log(`      💎 Captured ${node.type}: "${node.title.slice(0, 30)}..."`);
    }

    const children = await treeStore.getChildren(node.id);
    if (children.length === 0 || depth >= maxDepth) return;

    // Build candidate list for LLM
    const candidates = children.map(c => {
      const typeIcon = isFolder(c) ? '📂' : (c.type === 'document' ? '📄' : '🧩');
      return `ID: ${c.id}\nType: ${typeIcon} ${c.type}\nTitle: ${c.title}\nGist: ${c.gist.slice(0, 150)}`;
    }).join('\n\n');

    const isOrientation = depth <= orientationThreshold;
    const depthContext = isOrientation ? "Orientation (Broad Search)" : "Targeting (Specific Search)";
    const parentContext = node.gist || node.title;

    console.log(`   📂 [Scout] Scanning ${children.length} children at "${node.title.slice(0, 30)}..." (${depthContext})`);

    try {
      const decisionJson = await this.llm.complete(
        DEFAULT_PROMPTS.assessNeighborhood,
        { query, parentContext, childrenList: candidates, depthContext },
        { maxTokens: 1024 }
      );

      let decision;
      try {
        decision = JSON.parse(decisionJson);
      } catch (e) {
        console.warn("   ⚠️ Scout returned invalid JSON, skipping branch.");
        return;
      }

      const targetIds = decision.relevantIds || [];

      if (targetIds.length > 0) {
        console.log(`      👉 Scout picked ${targetIds.length} paths.`);

        for (const targetId of targetIds) {
          const child = children.find(c => c.id === targetId);
          if (!child) continue;

          if (hasContent(child)) {
            // Document or Fragment: Grab directly
            if (!visited.has(child.id)) {
              visited.add(child.id);
              const content = await this.resolveContent(child, targetResolution, effectiveTreeId);
              results.push({
                nodeId: child.id,
                path: child.path,
                resolution: targetResolution,
                content,
                contentId: child.contentId
              });
              console.log(`      💎 Captured ${child.type}: "${child.title.slice(0, 30)}..."`);
            }
          } else {
            // Folder: Recurse
            await this.drill(
              child, query, maxDepth, targetResolution,
              results, visited, depth + 1, orientationThreshold, totalTreeDepth,
              false, effectiveTreeId
            );
          }
        }
      } else {
        console.log("      🛑 Dead End. Scout sees no leads.");
      }

    } catch (e) {
      console.error("   ❌ Scout Error", e);
    }
  }

  private async resolveContent(node: TreeNode, resolution: 'L0' | 'L1' | 'L2', treeId?: string): Promise<string> {
    // Get the correct content store for KB-aware routing
    const effectiveTreeId = treeId || node.treeId;
    const contentStore = this.getContentStore(effectiveTreeId);

    switch (resolution) {
      case 'L0':
        return node.gist;
      case 'L1':
        // For strict taxonomy, L1 is just the gist (no more L1Map)
        return node.gist;
      case 'L2':
        if (hasContent(node)) {
          const content = await contentStore.get(node.contentId);
          return content?.payload ?? node.gist;
        }
        return node.gist;
    }
  }

  async browse(request: BrowseRequest): Promise<BrowseResult> {
    // Get the correct tree store for KB-aware routing
    const treeStore = this.getTreeStore(request.treeId);

    const tree = await treeStore.getTree(request.treeId);
    const nodeId = request.nodeId ?? tree.rootNodeId;
    const node = await treeStore.getNodeFromTree(request.treeId, nodeId);

    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const children = await treeStore.getChildren(nodeId);
    const parent = node.parentId ? await treeStore.getNode(node.parentId) : null;

    return {
      node: {
        id: node.id,
        path: node.path,
        type: node.type,
        title: node.title,
        gist: node.gist
      },
      children: children.map(c => ({
        id: c.id,
        type: c.type,
        title: c.title,
        gist: c.gist
      })),
      parent: parent ? { id: parent.id, title: parent.title } : undefined
    };
  }
}
