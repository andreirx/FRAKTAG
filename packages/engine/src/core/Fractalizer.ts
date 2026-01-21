import { randomUUID } from 'crypto';
import { ContentStore } from './ContentStore.js';
import { TreeStore } from './TreeStore.js';
import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { TreeNode, IngestionConfig, PromptSet, TreeConfig } from './types.js';
import { VectorStore } from './VectorStore.js';

export class Fractalizer {
  constructor(
      private contentStore: ContentStore,
      private treeStore: TreeStore,
      private vectorStore: VectorStore,
      private basicLlm: ILLMAdapter,
      private smartLlm: ILLMAdapter,
      private config: IngestionConfig,
      private prompts: PromptSet
  ) {
  }

  async ingest(
      content: string,
      treeId: string,
      parentId: string | null,
      currentPath: string,
      depth: number = 0
  ): Promise<TreeNode> {
    const wordCount = content.split(/\s+/).length;

    // === ATOMIC PATH (< 150 words) ===
    if (wordCount < 150) {
      console.log(`   ⚛️  Atomic Content detected (${wordCount} words). Skipping split logic.`);

      const contentAtom = await this.contentStore.create({
        payload: content,
        mediaType: 'text/plain',
        createdBy: 'system',
      });

      let gist = content;
      if (wordCount > 50) {
        const tree = await this.treeStore.getTree(treeId);
        gist = await this.basicLlm.complete(
            this.prompts.generateGist,
            {content, organizingPrinciple: tree.organizingPrinciple}
        );
      }

      if (parentId) {
        const nodeId = randomUUID();
        const node: TreeNode = {
          id: nodeId,
          treeId,
          parentId,
          path: `${currentPath}/${nodeId}`,
          contentId: contentAtom.id,
          l0Gist: gist,
          l1Map: null,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await this.vectorStore.add(nodeId, `Atomic: ${content}`);
        await this.treeStore.saveNode(node);
        await this.vectorStore.save(treeId);
        await this.bubbleUp(parentId);
        return node;
      } else {
        return this.autoPlace(contentAtom.id, gist, treeId, true);
      }
    }

    // === STANDARD PATH ===
    const contentAtom = await this.contentStore.create({
      payload: content,
      mediaType: 'text/plain',
      createdBy: 'system',
    });

    const tree = await this.treeStore.getTree(treeId);
    const rawGist = await this.basicLlm.complete(
        this.prompts.generateGist,
        {content, organizingPrinciple: tree.organizingPrinciple}
    );
    const gist = await this.sanctify(content, rawGist, treeId, 'L0');

    if (parentId) {
      return this.processContentWithSplitting(content, contentAtom.id, gist, treeId, parentId, currentPath, depth);
    } else {
      return this.autoPlace(contentAtom.id, gist, treeId, false);
    }
  }

  private async processContentWithSplitting(
      content: string,
      contentId: string | null,
      gist: string,
      treeId: string,
      parentId: string,
      currentPath: string,
      depth: number
  ): Promise<TreeNode> {

    const nodeId = randomUUID();
    const path = parentId ? `${currentPath}/${nodeId}` : `/${nodeId}`;

    await this.vectorStore.add(nodeId, `Gist: ${gist}\n${content.slice(0, 500)}`);

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

    // Stop recursion if too deep
    if (depth >= this.config.maxDepth) {
      await this.treeStore.saveNode(node);
      return node;
    }

    // === CENSUS & SPLIT STRATEGY ===
    const strategy = this.determineSplitStrategy(content);

    if (strategy.method !== 'NONE') {
      console.log(`   🔪 Level ${depth}: Splitting via [${strategy.method}] into ${strategy.chunks.length} chunks.`);

      // 1. CONVERT TO FOLDER
      node.contentId = null;

      const children: TreeNode[] = [];
      const tree = await this.treeStore.getTree(treeId);

      for (let i = 0; i < strategy.chunks.length; i++) {
        const chunk = strategy.chunks[i];

        const chunkAtom = await this.contentStore.create({
          payload: chunk,
          mediaType: 'text/plain',
          createdBy: 'system',
          metadata: {parentOriginalId: contentId, splitIndex: i, method: strategy.method}
        });

        // Optimization: If chunk is tiny, skip LLM gist
        let chunkGist = "";
        if (chunk.length < 200) {
          chunkGist = chunk.slice(0, 100).replace(/\n/g, ' ');
        } else {
          const raw = await this.basicLlm.complete(
              this.prompts.generateGist,
              {content: chunk.slice(0, 3000), organizingPrinciple: tree.organizingPrinciple}
          );
          chunkGist = await this.sanctify(chunk, raw, treeId, 'L0');
        }

        const child = await this.processContentWithSplitting(
            chunk,
            chunkAtom.id,
            chunkGist,
            treeId,
            nodeId,
            path,
            depth + 1
        );
        child.sortOrder = i;

        await this.treeStore.saveNode(child);
        children.push(child);
      }

      // 2. DETERMINISTIC L1 MAP
      const summaryList = children.map(c => `- ${c.l0Gist}`).join('\n');

      node.l1Map = {
        summary: `Contains ${children.length} items:\n${summaryList.slice(0, 1000)}`,
        childInventory: children.map(c => ({nodeId: c.id, gist: c.l0Gist})), // Kept for API compat if needed
        outboundRefs: []
      };
    }

    await this.treeStore.saveNode(node);
    await this.vectorStore.save(treeId);

    if (parentId) await this.bubbleUp(parentId);

    return node;
  }

  private determineSplitStrategy(content: string): { method: string, chunks: string[] } {
    const len = content.length;
    if (len < 500) return {method: 'NONE', chunks: []};

    const patterns = {
      'PDF_PAGE': /(\n\n---=== PAGE \d+ ===---\n\n)/,
      'MARKER_HR': /(^\s*---\s*$)/m,
      'H1': /^#\s+(.+)$/gm,
      'H2': /^##\s+(.+)$/gm,
      'H3': /^###\s+(.+)$/gm
    };

    // 1. Explicit Markers (PDF)
    const pageChunks = this.splitByRegexDelimiter(content, patterns.PDF_PAGE);
    if (pageChunks.length > 1) return {method: 'PDF_PAGE', chunks: pageChunks};

    // 2. Headers
    const MAX_CHUNKS = 60;
    const MIN_AVG_LEN = 200;

    const h1Chunks = this.splitByHeader(content, patterns.H1);
    if (this.isValidSplit(h1Chunks, MAX_CHUNKS, MIN_AVG_LEN)) return {method: 'H1', chunks: h1Chunks};

    const h2Chunks = this.splitByHeader(content, patterns.H2);
    if (this.isValidSplit(h2Chunks, MAX_CHUNKS, MIN_AVG_LEN)) return {method: 'H2', chunks: h2Chunks};

    const h3Chunks = this.splitByHeader(content, patterns.H3);
    if (this.isValidSplit(h3Chunks, MAX_CHUNKS, MIN_AVG_LEN)) return {method: 'H3', chunks: h3Chunks};

    // 3. HR Markers
    const hrChunks = this.splitByRegexDelimiter(content, patterns.MARKER_HR);
    if (this.isValidSplit(hrChunks, 100, 100)) return {method: 'HR', chunks: hrChunks};

    return {method: 'NONE', chunks: []};
  }

  private isValidSplit(chunks: string[], maxCount: number, minAvgLen: number): boolean {
    if (chunks.length < 2) return false;
    if (chunks.length > maxCount) return false;
    const avg = chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length;
    return avg >= minAvgLen;
  }

  private splitByRegexDelimiter(content: string, regex: RegExp): string[] {
    return content.split(regex)
        .map(p => p.trim())
        .filter(p => p.length > 0 && !regex.test(p) && !p.startsWith('---==='));
  }

  private splitByHeader(content: string, regex: RegExp): string[] {
    const matches = [...content.matchAll(regex)];
    if (matches.length < 2) return [];

    const chunks: string[] = [];
    if (matches[0].index! > 0) chunks.push(content.slice(0, matches[0].index).trim());

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index!;
      const end = matches[i + 1] ? matches[i + 1].index! : content.length;
      chunks.push(content.slice(start, end).trim());
    }
    return chunks;
  }

  async autoPlace(
      contentId: string,
      gist: string,
      treeId: string,
      isAtomic: boolean = false
  ): Promise<TreeNode> {
    const tree = await this.treeStore.getTree(treeId);
    let currentParentId = tree.rootNodeId;
    let currentParent = await this.treeStore.getNodeFromTree(treeId, currentParentId);

    if (!currentParent) throw new Error(`Root node not found for tree: ${treeId}`);

    const maxPlacementDepth = 3;
    let depth = 0;

    while (depth < maxPlacementDepth) {
      const children = await this.treeStore.getChildren(currentParentId);

      // --- SEMANTIC DEDUPLICATION ---
      let merged = false;
      for (const child of children) {
        const isMatch = await this.checkSemanticMatch(gist, child.l0Gist);
        if (isMatch) {
          console.log(`   🔄 Semantic Match found: "${child.l0Gist.slice(0, 30)}..." matches new content.`);

          if (child.contentId) {
            // If leaf, convert to folder and dive
            console.log(`      📂 Converting Leaf "${child.l0Gist}" to Category Cluster`);
            const oldContentNodeId = randomUUID();
            const oldContentNode: TreeNode = {
              ...child,
              id: oldContentNodeId,
              parentId: child.id,
              path: `${child.path}/${oldContentNodeId}`,
              l0Gist: `${child.l0Gist} (Original)`,
              sortOrder: 0,
              l1Map: null
            };
            child.contentId = null;
            child.l1Map = null;

            await this.treeStore.saveNode(oldContentNode);
            await this.treeStore.saveNode(child);
            await this.vectorStore.add(oldContentNode.id, `Gist: ${oldContentNode.l0Gist}`);

            currentParent = child;
            currentParentId = child.id;
            depth++;
            merged = true;
            break;
          } else {
            // Folder, dive
            currentParent = child;
            currentParentId = child.id;
            depth++;
            merged = true;
            break;
          }
        }
      }
      if (merged) continue;
      // --- END DEDUPLICATION ---

      if (children.length === 0) break;

      const candidates = children.map(c => `- ${c.id}: ${c.l0Gist}`).join('\n');

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
          const categoryNode = await this.createOrganizationalNode(treeId, currentParentId, currentParent.path, categoryName);
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
    if (!content) throw new Error(`Content not found: ${contentId}`);

    if (isAtomic) {
      const nodeId = randomUUID();
      const node: TreeNode = {
        id: nodeId,
        treeId,
        parentId: currentParentId,
        path: `${currentParent.path}${nodeId}`,
        contentId,
        l0Gist: gist,
        l1Map: null,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.vectorStore.add(nodeId, `Atomic: ${content.payload}`);
      await this.treeStore.saveNode(node);
      await this.vectorStore.save(treeId);
      await this.bubbleUp(currentParentId);
      return node;
    } else {
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
  }

  // --- MUTATION ---
  async updateNode(nodeId: string, newContentAtomId: string, newContentText: string): Promise<void> {
    console.log(`   📝 Updating Node: ${nodeId}`);
    const node = await this.treeStore.getNode(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    node.contentId = newContentAtomId;
    node.updatedAt = new Date().toISOString();

    const tree = await this.treeStore.getTree(node.treeId);
    const rawGist = await this.basicLlm.complete(
        this.prompts.generateGist,
        {content: newContentText, organizingPrinciple: tree.organizingPrinciple}
    );
    node.l0Gist = await this.sanctify(newContentText, rawGist, node.treeId, 'L0');

    await this.vectorStore.remove(node.id);
    await this.vectorStore.add(node.id, `Gist: ${node.l0Gist}\n${newContentText.slice(0, 300)}`);
    await this.treeStore.saveNode(node);
    await this.vectorStore.save(node.treeId);
    if (node.parentId) await this.bubbleUp(node.parentId);
  }

  // --- HELPERS ---
  private async checkSemanticMatch(newGist: string, existingGist: string): Promise<boolean> {
    if (newGist === existingGist) return true;
    try {
      const prompt = this.prompts.checkSimilarity || `Respond ONLY with JSON: {"status": "MATCH" | "DIFFERENT"}`;
      const response = await this.basicLlm.complete(prompt, {newGist, existingGist});
      const json = JSON.parse(response);
      return json.status === 'MATCH';
    } catch (e) {
      return false;
    }
  }

  private async createOrganizationalNode(treeId: string, parentId: string, parentPath: string, name: string): Promise<TreeNode> {
    const id = `${parentId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const path = `${parentPath}/${id}`;
    const existing = await this.treeStore.getNodeFromTree(treeId, id);
    if (existing) return existing;

    const node: TreeNode = {
      id, treeId, parentId, path, contentId: null, l0Gist: name, l1Map: null, sortOrder: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await this.vectorStore.add(id, `Category: ${name}`);
    await this.treeStore.saveNode(node);
    if (parentId) await this.bubbleUp(parentId);
    return node;
  }

  private getPlacementStrategy(tree: TreeConfig | { organizingPrinciple: string; placementStrategy?: string }): string {
    if ('placementStrategy' in tree && tree.placementStrategy) return tree.placementStrategy;
    return 'Group by related topics and themes';
  }

  private async sanctify(content: string, proposedSummary: string, treeId: string, summaryType: 'L0' | 'L1' = 'L0'): Promise<string> {
    console.log(`\\n🔍 [The Inquisitor] Inspecting ${summaryType} for Tree: ${treeId}`);
    try {
      const tree = await this.treeStore.getTree(treeId);
      const contentSample = summaryType === 'L0' ? content.slice(0, 3000) : content;
      const heresyCheck = await this.smartLlm.complete(
          this.prompts.detectHeresy,
          {content: contentSample, summary: proposedSummary, organizingPrinciple: tree.organizingPrinciple}
      );
      let verdict;
      try {
        verdict = JSON.parse(heresyCheck);
      } catch (e) {
        return proposedSummary;
      }
      if (verdict.status === 'FAIL') {
        console.warn(`⚠️ [HERESY DETECTED] Reason: ${verdict.reason}`);
        return verdict.correctedSummary || proposedSummary;
      }
      return proposedSummary;
    } catch (e) {
      return proposedSummary;
    }
  }

  private async bubbleUp(nodeId: string): Promise<void> {
    const node = await this.treeStore.getNode(nodeId);
    if (!node) return;
    const children = await this.treeStore.getChildren(nodeId);
    if (children.length === 0) return;

    // Deterministic L1 (Concatenation)
    const childSummaries = children.map(c => `- ${c.l0Gist}`).join('\n');
    node.l1Map = {
      summary: `Contains ${children.length} items:\n${childSummaries.slice(0, 1000)}`,
      childInventory: children.map(c => ({nodeId: c.id, gist: c.l0Gist})),
      outboundRefs: [],
    };

    node.updatedAt = new Date().toISOString();
    await this.vectorStore.add(node.id, `Category: ${node.l0Gist}\n${childSummaries.slice(0, 500)}`);
    await this.vectorStore.save(node.treeId);
    await this.treeStore.saveNode(node);

    // No recursive bubbleUp needed if using deterministic summaries, 
    // but useful if vector index relies on full path context.
    if (node.parentId) await this.bubbleUp(node.parentId);
  }

  /**
   * Regenerate summaries for a node and its ancestors
   */
  async regenerateSummaries(nodeId: string): Promise<void> {
    const node = await this.treeStore.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    await this.bubbleUp(nodeId);
    if (node.parentId) await this.regenerateSummaries(node.parentId);
  }
}