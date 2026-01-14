// src/core/TreeStore.ts

import { Tree, TreeNode, TreeConfig } from './types.js';
import { JsonStorage } from '../adapters/storage/JsonStorage.js';

/**
 * Monolithic file structure for a tree
 * Contains the tree configuration and all nodes in a single JSON file
 */
interface TreeFile {
  config: Tree;
  nodes: Record<string, TreeNode>; // nodeId -> TreeNode
}

/**
 * TreeStore manages trees using monolithic JSON files
 * Each tree is stored as a single file: trees/{treeId}.json
 * This makes trees portable - just copy the file!
 */
export class TreeStore {
  private storage: JsonStorage;
  // In-memory cache to prevent constant disk I/O during batch operations
  private cache: Map<string, TreeFile> = new Map();

  constructor(storage: JsonStorage) {
    this.storage = storage;
  }

  // ============ HELPER: LOAD/SAVE ============

  /**
   * Load tree file from storage (with caching)
   */
  private async loadTreeFile(treeId: string): Promise<TreeFile> {
    if (this.cache.has(treeId)) {
      return this.cache.get(treeId)!;
    }

    const file = await this.storage.read<TreeFile>(`trees/${treeId}.json`);
    if (!file) {
      throw new Error(`Tree file not found: ${treeId}`);
    }

    this.cache.set(treeId, file);
    return file;
  }

  /**
   * Save tree file to storage (updates cache)
   */
  private async saveTreeFile(treeId: string, data: TreeFile): Promise<void> {
    this.cache.set(treeId, data);
    await this.storage.write(`trees/${treeId}.json`, data);
  }

  /**
   * Clear cache for a specific tree or all trees
   */
  clearCache(treeId?: string): void {
    if (treeId) {
      this.cache.delete(treeId);
    } else {
      this.cache.clear();
    }
  }

  // ============ TREE OPERATIONS ============

  /**
   * Create a new tree with root node
   */
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

    const rootNode: TreeNode = {
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
    };

    const treeFile: TreeFile = {
      config: treeMeta,
      nodes: {
        [rootNodeId]: rootNode,
      },
    };

    await this.saveTreeFile(config.id, treeFile);
    return treeMeta;
  }

  /**
   * Get tree configuration
   */
  async getTree(treeId: string): Promise<Tree> {
    const file = await this.loadTreeFile(treeId);
    return file.config;
  }

  /**
   * List all trees in storage
   */
  async listTrees(): Promise<Tree[]> {
    const files = await this.storage.list('trees');
    const trees: Tree[] = [];

    for (const filename of files) {
      if (!filename.endsWith('.json')) continue;
      const treeId = filename.replace('.json', '');
      try {
        const file = await this.loadTreeFile(treeId);
        trees.push(file.config);
      } catch (error) {
        console.error(`Failed to load tree ${treeId}:`, error);
      }
    }

    return trees;
  }

  /**
   * Update tree metadata
   */
  async updateTree(tree: Tree): Promise<void> {
    const file = await this.loadTreeFile(tree.id);
    file.config = tree;
    file.config.updatedAt = new Date().toISOString();
    await this.saveTreeFile(tree.id, file);
  }

  /**
   * Delete a tree
   */
  async deleteTree(treeId: string): Promise<void> {
    await this.storage.delete(`trees/${treeId}.json`);
    this.cache.delete(treeId);
  }

  // ============ NODE OPERATIONS ============

  /**
   * Save a tree node (updates the entire tree file)
   */
  async saveNode(node: TreeNode): Promise<void> {
    const file = await this.loadTreeFile(node.treeId);
    file.nodes[node.id] = node;

    // Update tree metadata timestamp
    file.config.updatedAt = new Date().toISOString();

    await this.saveTreeFile(node.treeId, file);
  }

  /**
   * Get a node by ID (searches across all trees)
   * Warning: Inefficient - prefer getNodeFromTree when treeId is known
   */
  async getNode(nodeId: string): Promise<TreeNode | null> {
    const trees = await this.listTrees();
    for (const tree of trees) {
      const node = await this.getNodeFromTree(tree.id, nodeId);
      if (node) return node;
    }
    return null;
  }

  /**
   * Get a node from a specific tree (efficient)
   */
  async getNodeFromTree(treeId: string, nodeId: string): Promise<TreeNode | null> {
    try {
      const file = await this.loadTreeFile(treeId);
      return file.nodes[nodeId] || null;
    } catch {
      return null;
    }
  }

  /**
   * Get all children of a node
   */
  async getChildren(nodeId: string): Promise<TreeNode[]> {
    // Need to find which tree this node belongs to
    const node = await this.getNode(nodeId);
    if (!node) return [];

    const file = await this.loadTreeFile(node.treeId);
    const children: TreeNode[] = [];

    for (const candidate of Object.values(file.nodes)) {
      if (candidate.parentId === nodeId) {
        children.push(candidate);
      }
    }

    return children.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Get all nodes in a tree
   */
  async getAllNodes(treeId: string): Promise<TreeNode[]> {
    const file = await this.loadTreeFile(treeId);
    return Object.values(file.nodes);
  }

  /**
   * Delete a node
   */
  async deleteNode(nodeId: string): Promise<void> {
    const node = await this.getNode(nodeId);
    if (!node) return;

    const file = await this.loadTreeFile(node.treeId);
    delete file.nodes[nodeId];

    file.config.updatedAt = new Date().toISOString();
    await this.saveTreeFile(node.treeId, file);
  }

  /**
   * Move a node to a new parent
   */
  async moveNode(nodeId: string, newParentId: string): Promise<TreeNode> {
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const file = await this.loadTreeFile(node.treeId);
    const newParent = file.nodes[newParentId];

    if (!newParent) {
      throw new Error(`Parent node not found: ${newParentId} in tree ${node.treeId}`);
    }

    // Update node's parent and path
    node.parentId = newParentId;
    node.path = `${newParent.path}${node.id}/`;
    node.updatedAt = new Date().toISOString();

    file.nodes[nodeId] = node;
    file.config.updatedAt = new Date().toISOString();

    await this.saveTreeFile(node.treeId, file);
    return node;
  }

  /**
   * Find all nodes that reference a specific content ID
   * Searches across all trees
   */
  async findNodesByContent(contentId: string): Promise<TreeNode[]> {
    const trees = await this.listTrees();
    const results: TreeNode[] = [];

    for (const tree of trees) {
      const file = await this.loadTreeFile(tree.id);
      for (const node of Object.values(file.nodes)) {
        if (node.contentId === contentId) {
          results.push(node);
        }
      }
    }

    return results;
  }

  /**
   * Get statistics for a tree
   */
  async getTreeStats(treeId: string): Promise<{
    totalNodes: number;
    contentNodes: number;
    organizationalNodes: number;
    maxDepth: number;
  }> {
    const file = await this.loadTreeFile(treeId);
    const nodes = Object.values(file.nodes);

    let contentNodes = 0;
    let maxDepth = 0;

    for (const node of nodes) {
      if (node.contentId) contentNodes++;

      // Calculate depth from path
      const depth = node.path.split('/').filter(p => p.length > 0).length;
      maxDepth = Math.max(maxDepth, depth);
    }

    return {
      totalNodes: nodes.length,
      contentNodes,
      organizationalNodes: nodes.length - contentNodes,
      maxDepth,
    };
  }
}
