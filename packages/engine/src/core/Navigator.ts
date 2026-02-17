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
  ProgressCallback,
  isFolder,
  isDocument,
  hasContent
} from './types.js';
import { DEFAULT_PROMPTS } from '../prompts/default.js';
import { AssessVectorCandidatesNugget } from '../nuggets/AssessVectorCandidates.js';
import { GlobalMapScanNugget } from '../nuggets/GlobalMapScan.js';
import { AssessNeighborhoodNugget } from '../nuggets/AssessNeighborhood.js';

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
  private assessVectorCandidates: AssessVectorCandidatesNugget;
  private globalMapScan: GlobalMapScanNugget;
  private assessNeighborhood: AssessNeighborhoodNugget;
  private contextWindow: number;

  constructor(
    private contentStore: ContentStore,
    private treeStore: TreeStore,
    private vectorStore: VectorStore,
    private llm: ILLMAdapter,
    contextWindow?: number
  ) {
    this.assessVectorCandidates = new AssessVectorCandidatesNugget(llm);
    this.globalMapScan = new GlobalMapScanNugget(llm);
    this.assessNeighborhood = new AssessNeighborhoodNugget(llm);
    this.contextWindow = contextWindow ?? 25000;
  }

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

  async retrieve(request: RetrieveRequest, onProgress?: ProgressCallback, signal?: AbortSignal): Promise<RetrieveResult> {
    const log = (msg: string, phase?: string) => {
      console.log(msg);
      onProgress?.(msg, phase);
    };

    const checkAbort = () => {
      if (signal?.aborted) throw new DOMException('Retrieval aborted', 'AbortError');
    };

    // Get the correct stores for this tree (KB-aware routing)
    const treeStore = this.getTreeStore(request.treeId);
    const vectorStore = this.getVectorStore(request.treeId);

    const tree = await treeStore.getTree(request.treeId);
    await vectorStore.load(request.treeId);

    log(`🧭 Starting Retrieval: ${tree.name}`, 'init');
    log(`   Quest: "${request.query}"`, 'init');

    const results: RetrievedNode[] = [];
    const visited = new Set<string>();
    const candidates = new Set<string>();

    // =========================================================
    // PHASE 1: VECTOR BATCH RECONNAISSANCE
    // =========================================================
    log(`🔍 [Phase 1] Vector Neighborhood Scan`, 'vector');
    // Use searchNodes for multi-chunk aware search with node-level aggregation
    const nodeResults = await vectorStore.searchNodes(request.query, 5);
    // Convert to legacy format for buildNeighborhoodContext
    const seeds = nodeResults.map(r => ({ id: r.nodeId, score: r.score }));
    const validSeeds = seeds.filter(s => s.score > 0.25);

    if (validSeeds.length > 0) {
      const neighborhoodText = await this.buildNeighborhoodContext(validSeeds, request.treeId);

      try {
        const decision = await this.assessVectorCandidates.run(
          { query: request.query, neighborhoods: neighborhoodText },
          { maxTokens: 2048 }
        );
        const targetIds = decision.relevantNodeIds;

        log(`   Scout selected ${targetIds.length} nodes from vectors.`, 'vector');

        for (const id of targetIds) {
          if (visited.has(id)) continue;

          const node = await treeStore.getNode(id);
          if (node) {
            visited.add(id);

            // Document or Fragment: Grab content directly
            if (hasContent(node)) {
              log(`   💎 Captured ${node.type}: "${node.title.slice(0, 50)}..."`, 'vector');
              const resolved = await this.resolveWithFragments(node, request.query, request.resolution || 'L2', request.treeId);
              for (const r of resolved) {
                r.source = 'vector';
                results.push(r);
              }
            } else {
              // Folder: Queue for drilling
              visited.delete(id);
              candidates.add(id);
              log(`   📂 Queueing Folder: "${node.title.slice(0, 50)}..."`, 'vector');
            }
          }
        }
      } catch (e) {
        console.error("   ❌ Vector Batch Scan failed:", e);
      }
    }

    checkAbort();

    // =========================================================
    // PHASE 2: GLOBAL MAP SCAN
    // =========================================================
    log(`🔍 [Phase 2] Global Map Scan`, 'map');
    const fullTreeMap = await treeStore.generateTreeMap(request.treeId);

    const CHUNK_SIZE = this.contextWindow;
    const OVERLAP = 1000;
    const mapChunks = this.chunkText(fullTreeMap, CHUNK_SIZE, OVERLAP);

    if (mapChunks.length > 1) {
      log(`   Map too large (${fullTreeMap.length} chars). Split into ${mapChunks.length} chunks.`, 'map');
    }

    // Serialize map scan — each chunk requires an LLM call, and local LLMs
    // (MLX/Ollama) cannot handle concurrent requests without context thrashing.
    const allTargets: string[] = [];
    for (let index = 0; index < mapChunks.length; index++) {
      checkAbort();
      const chunk = mapChunks[index];
      try {
        const partialContext = mapChunks.length > 1
          ? `(Part ${index + 1} of ${mapChunks.length})`
          : "";

        const scan = await this.globalMapScan.run(
          {
            query: request.query,
            treeMap: `[Map Segment ${partialContext}]\n${chunk}`
          },
          { maxTokens: 2048 }
        );
        allTargets.push(...scan.targetIds);
      } catch (e: any) {
        console.error(`   ❌ Map Scan failed for chunk ${index + 1}: ${e.message || e}`);
      }
    }
    const uniqueTargets = [...new Set(allTargets)];
    log(`   Strategist identified ${uniqueTargets.length} targets from map scan.`, 'map');
    uniqueTargets.forEach((id: string) => candidates.add(id));

    checkAbort();

    // =========================================================
    // PHASE 3: PRECISION DRILLING
    // =========================================================
    log(`🔍 [Phase 3] Investigating ${candidates.size} Candidates`, 'drill');

    for (const id of candidates) {
      checkAbort();
      if (visited.has(id)) continue;
      const node = await treeStore.getNode(id);
      if (!node) continue;

      log(`   🪂 Dive: ${node.title.slice(0, 50)}...`, 'drill');

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
        request.treeId,
        onProgress,
        signal
      );

      // Check parent context
      if (node.parentId) {
        const parent = await treeStore.getNode(node.parentId);
        if (parent && !visited.has(parent.id)) {
          await this.drill(parent, request.query, 1, request.resolution || 'L2', results, visited, 0, 0, 10, false, request.treeId, onProgress, signal);
        }
      }
    }

    const uniqueResults = Array.from(new Map(results.map(item => [item.nodeId, item])).values());
    log(`🏁 Exploration Complete. Found ${uniqueResults.length} relevant nodes.`, 'done');
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
    treeId?: string,
    onProgress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) return;

    const log = (msg: string, phase?: string) => {
      console.log(msg);
      onProgress?.(msg, phase);
    };

    // Get the correct tree store for KB-aware routing
    const effectiveTreeId = treeId || node.treeId;
    const treeStore = this.getTreeStore(effectiveTreeId);
    const contentStore = this.getContentStore(effectiveTreeId);

    if (visited.has(node.id)) return;
    visited.add(node.id);

    // If this node has content, grab it (fragment-aware)
    if (hasContent(node)) {
      const resolved = await this.resolveWithFragments(node, query, targetResolution, effectiveTreeId);
      for (const r of resolved) {
        r.source = 'map';
        results.push(r);
      }
      log(`   💎 Captured ${node.type}: "${node.title.slice(0, 30)}..."`, 'drill');
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

    log(`   📂 [Scout] Scanning ${children.length} children at "${node.title.slice(0, 30)}..." (${depthContext})`, 'drill');

    try {
      const decision = await this.assessNeighborhood.run(
        { query, parentContext, childrenList: candidates, depthContext },
        { maxTokens: 2048 }
      );
      const targetIds = decision.relevantIds;

      if (targetIds.length > 0) {
        log(`   👉 Scout picked ${targetIds.length} paths.`, 'drill');

        for (const targetId of targetIds) {
          const child = children.find(c => c.id === targetId);
          if (!child) continue;

          if (hasContent(child)) {
            // Document or Fragment: Grab directly (fragment-aware)
            if (!visited.has(child.id)) {
              visited.add(child.id);
              const resolved = await this.resolveWithFragments(child, query, targetResolution, effectiveTreeId);
              for (const r of resolved) {
                r.source = 'map';
                results.push(r);
              }
              log(`   💎 Captured ${child.type}: "${child.title.slice(0, 30)}..."`, 'drill');
            }
          } else {
            // Folder: Recurse
            await this.drill(
              child, query, maxDepth, targetResolution,
              results, visited, depth + 1, orientationThreshold, totalTreeDepth,
              false, effectiveTreeId, onProgress, signal
            );
          }
        }
      } else {
        log(`   🛑 Dead End. Scout sees no leads.`, 'drill');
      }

    } catch (e) {
      console.error("   ❌ Scout Error", e);
    }
  }

  /**
   * Fragment-aware content resolution.
   * If the node is a document with fragment children, selects up to 3 relevant fragments
   * instead of returning the full document content (which could be huge).
   */
  private async resolveWithFragments(
    node: TreeNode,
    query: string,
    targetResolution: 'L0' | 'L1' | 'L2',
    treeId: string
  ): Promise<RetrievedNode[]> {
    if (!hasContent(node)) return [];

    // Only documents can have fragment children
    if (isDocument(node)) {
      const treeStore = this.getTreeStore(treeId);
      const children = await treeStore.getChildren(node.id);
      const fragments = children.filter(c => c.type === 'fragment');

      if (fragments.length > 0) {
        // Document has fragments — use them instead of full document
        if (fragments.length <= 3) {
          // Few fragments — return all
          const results: RetrievedNode[] = [];
          for (const f of fragments) {
            const content = await this.resolveContent(f, targetResolution, treeId);
            results.push({ nodeId: f.id, path: f.path, resolution: targetResolution, content, contentId: (f as any).contentId });
          }
          return results;
        }

        // Many fragments — ask LLM to pick top 3
        const candidates = fragments.map(c =>
          `ID: ${c.id}\nType: 🧩 fragment\nTitle: ${c.title}\nGist: ${c.gist.slice(0, 150)}`
        ).join('\n\n');

        try {
          const decision = await this.assessNeighborhood.run(
            { query, parentContext: node.gist || node.title, childrenList: candidates, depthContext: 'Targeting (Specific Search)' },
            { maxTokens: 2048 }
          );
          const selectedIds = decision.relevantIds.slice(0, 3);
          const results: RetrievedNode[] = [];
          for (const id of selectedIds) {
            const frag = fragments.find(f => f.id === id);
            if (frag) {
              const content = await this.resolveContent(frag, targetResolution, treeId);
              results.push({ nodeId: frag.id, path: frag.path, resolution: targetResolution, content, contentId: (frag as any).contentId });
            }
          }
          if (results.length > 0) {
            console.log(`      🧩 Resolved ${results.length} fragments from document "${node.title.slice(0, 30)}..."`);
            return results;
          }
        } catch (e) {
          console.error(`      ⚠️ Fragment selection failed, using first 3 fragments`);
        }

        // Fallback: return first 3 fragments
        const results: RetrievedNode[] = [];
        for (const f of fragments.slice(0, 3)) {
          const content = await this.resolveContent(f, targetResolution, treeId);
          results.push({ nodeId: f.id, path: f.path, resolution: targetResolution, content, contentId: (f as any).contentId });
        }
        return results;
      }
    }

    // No fragments or not a document — return the node content directly
    const content = await this.resolveContent(node, targetResolution, treeId);
    return [{ nodeId: node.id, path: node.path, resolution: targetResolution, content, contentId: (node as any).contentId }];
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
