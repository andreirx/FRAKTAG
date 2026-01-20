// packages/engine/src/core/TreeStore.ts

import { Tree, TreeNode, TreeConfig } from './types.js';
import { JsonStorage } from '../adapters/storage/JsonStorage.js';

interface TreeFile {
  config: Tree;
  nodes: Record<string, TreeNode>;
}

export class TreeStore {
  private storage: JsonStorage;
  private cache: Map<string, TreeFile> = new Map();

  constructor(storage: JsonStorage) {
    this.storage = storage;
  }

  private async loadTreeFile(treeId: string): Promise<TreeFile> {
    if (this.cache.has(treeId)) return this.cache.get(treeId)!;

    // Try loading monolithic file
    let file = await this.storage.read<TreeFile>(`trees/${treeId}.json`);

    // MIGRATION FALLBACK: If monolithic doesn't exist, try loading old folder structure?
    // No, for clean start, we just throw or return null if creating.
    if (!file) {
      throw new Error(`Tree file not found: ${treeId}`);
    }

    this.cache.set(treeId, file);
    return file;
  }

  private async saveTreeFile(treeId: string, data: TreeFile): Promise<void> {
    this.cache.set(treeId, data);
    await this.storage.write(`trees/${treeId}.json`, data);
  }

  async createTree(config: TreeConfig): Promise<Tree> {
    const rootNodeId = `root-${config.id}`;
    const now = new Date().toISOString();
    const treeMeta: Tree = {
      id: config.id,
      name: config.name,
      organizingPrinciple: config.organizingPrinciple,
      rootNodeId,
      createdAt: now,
      updatedAt: now,
    };

    const treeFile: TreeFile = {
      config: treeMeta,
      nodes: {
        [rootNodeId]: {
          id: rootNodeId,
          treeId: config.id,
          parentId: null,
          path: '/',
          contentId: null,
          l0Gist: `Root of ${config.name}`,
          l1Map: null,
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        }
      }
    };

    await this.saveTreeFile(config.id, treeFile);
    return treeMeta;
  }

  async getTree(treeId: string): Promise<Tree> {
    const file = await this.loadTreeFile(treeId);
    return file.config;
  }

  async listTrees(): Promise<Tree[]> {
    const files = await this.storage.list('trees');
    const trees: Tree[] = [];
    for (const f of files) {
      if (f.endsWith('.json')) {
        try {
          const file = await this.storage.read<TreeFile>(`trees/${f}`);
          if (file?.config) trees.push(file.config);
        } catch (e) {}
      }
    }
    return trees;
  }

  async saveNode(node: TreeNode): Promise<void> {
    const file = await this.loadTreeFile(node.treeId);
    file.nodes[node.id] = node;
    file.config.updatedAt = new Date().toISOString();
    await this.saveTreeFile(node.treeId, file);
  }

  async getNode(nodeId: string): Promise<TreeNode | null> {
    const trees = await this.listTrees();
    for (const tree of trees) {
      const node = await this.getNodeFromTree(tree.id, nodeId);
      if (node) return node;
    }
    return null;
  }

  async getNodeFromTree(treeId: string, nodeId: string): Promise<TreeNode | null> {
    try {
      const file = await this.loadTreeFile(treeId);
      return file.nodes[nodeId] || null;
    } catch { return null; }
  }

  async getChildren(nodeId: string): Promise<TreeNode[]> {
    const node = await this.getNode(nodeId);
    if (!node) return [];
    const file = await this.loadTreeFile(node.treeId);
    return Object.values(file.nodes)
        .filter(n => n.parentId === nodeId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getAllNodes(treeId: string): Promise<TreeNode[]> {
    const file = await this.loadTreeFile(treeId);
    return Object.values(file.nodes);
  }

  async moveNode(nodeId: string, newParentId: string): Promise<TreeNode> {
    const node = await this.getNode(nodeId);
    if (!node) throw new Error("Node not found");
    const file = await this.loadTreeFile(node.treeId);
    const parent = file.nodes[newParentId];
    if (!parent) throw new Error("Parent not found");

    node.parentId = newParentId;
    node.path = `${parent.path}${node.id}/`;
    node.updatedAt = new Date().toISOString();
    file.nodes[node.id] = node;

    await this.saveTreeFile(node.treeId, file);
    return node;
  }

  async findNodesByContent(contentId: string): Promise<TreeNode[]> {
    const trees = await this.listTrees();
    const res: TreeNode[] = [];
    for (const t of trees) {
      const file = await this.loadTreeFile(t.id);
      res.push(...Object.values(file.nodes).filter(n => n.contentId === contentId));
    }
    return res;
  }

  async deleteTree(treeId: string): Promise<void> {
    await this.storage.delete(`trees/${treeId}.json`);
    this.cache.delete(treeId);
  }

  /**
   * Calculate statistics for the tree to help with navigation heuristics.
   */
  async getTreeStats(treeId: string): Promise<{ maxDepth: number; totalNodes: number }> {
    const file = await this.loadTreeFile(treeId);
    const nodes = Object.values(file.nodes);
    let maxDepth = 0;

    for (const node of nodes) {
      // Path format is like: /root-id/child-id/grandchild-id
      // Split by '/' and filter empty strings to count segments
      const segments = node.path.split('/').filter(p => p.length > 0);
      const depth = segments.length;
      if (depth > maxDepth) maxDepth = depth;
    }

    // If tree is empty or just root, ensure at least 1 to prevent divide-by-zero issues elsewhere
    return {
      maxDepth: Math.max(1, maxDepth),
      totalNodes: nodes.length
    };
  }

  /**
   * Generates a token-efficient ASCII tree map for the "First Glance" capability.
   * Format:
   * [id] Root Gist
   *   [child_id] Child Gist
   */
  async generateTreeMap(treeId: string): Promise<string> {
    const file = await this.loadTreeFile(treeId);
    const root = file.nodes[file.config.rootNodeId];
    if (!root) return "Tree is empty.";

    return this.buildMapRecursive(file.nodes, root, 0);
  }

  private buildMapRecursive(
      allNodes: Record<string, TreeNode>,
      currentNode: TreeNode,
      depth: number
  ): string {
    const indent = '  '.repeat(depth);
    // Format: "  [node-id] The Gist text..."
    let output = `${indent}[${currentNode.id}] ${currentNode.l0Gist}\n`;

    // Find children manually (since we have the full record loaded)
    const children = Object.values(allNodes)
        .filter(n => n.parentId === currentNode.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);

    for (const child of children) {
      output += this.buildMapRecursive(allNodes, child, depth + 1);
    }

    return output;
  }
}
