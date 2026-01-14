// src/core/TreeStore.ts

import { randomUUID } from 'crypto';
import { Tree, TreeNode, TreeConfig } from './types.js';
import { JsonStorage } from '../adapters/storage/JsonStorage.js';

/**
 * TreeStore manages trees and their nodes
 */
export class TreeStore {
  private storage: JsonStorage;

  constructor(storage: JsonStorage) {
    this.storage = storage;
  }

  /**
   * Create a new tree from config
   */
  async createTree(config: TreeConfig): Promise<Tree> {
    const rootNodeId = `root-${config.id}`;
    const now = new Date().toISOString();

    const tree: Tree = {
      id: config.id,
      name: config.name,
      organizingPrinciple: config.organizingPrinciple,
      rootNodeId,
      createdAt: now,
      updatedAt: now,
    };

    // Create tree directory structure
    await this.storage.ensureDir(`trees/${config.id}/nodes`);
    await this.storage.write(`trees/${config.id}/tree.json`, tree);

    // Create root node
    const rootNode: TreeNode = {
      id: rootNodeId,
      treeId: config.id,
      parentId: null,
      path: '/',
      contentId: null,
      l0Gist: `Root of ${config.name} tree`,
      l1Map: null,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.saveNode(rootNode);

    return tree;
  }

  /**
   * Get a tree by ID
   */
  async getTree(treeId: string): Promise<Tree> {
    const tree = await this.storage.read<Tree>(`trees/${treeId}/tree.json`);
    if (!tree) {
      throw new Error(`Tree not found: ${treeId}`);
    }
    return tree;
  }

  /**
   * List all trees
   */
  async listTrees(): Promise<Tree[]> {
    const treeDirs = await this.storage.list('trees');
    const trees: Tree[] = [];

    for (const treeDir of treeDirs) {
      try {
        const tree = await this.storage.read<Tree>(`trees/${treeDir}/tree.json`);
        if (tree) {
          trees.push(tree);
        }
      } catch {
        // Skip invalid tree directories
        continue;
      }
    }

    return trees;
  }

  /**
   * Update tree metadata
   */
  async updateTree(tree: Tree): Promise<void> {
    tree.updatedAt = new Date().toISOString();
    await this.storage.write(`trees/${tree.id}/tree.json`, tree);
  }

  /**
   * Delete a tree and all its nodes
   */
  async deleteTree(treeId: string): Promise<void> {
    await this.storage.delete(`trees/${treeId}`);
  }

  /**
   * Save a tree node
   */
  async saveNode(node: TreeNode): Promise<void> {
    await this.storage.write(`trees/${node.treeId}/nodes/${node.id}.json`, node);
  }

  /**
   * Get a tree node by ID
   */
  async getNode(nodeId: string): Promise<TreeNode | null> {
    // We need to find which tree this node belongs to
    // This is inefficient but works for the JSON storage model
    const trees = await this.listTrees();

    for (const tree of trees) {
      const node = await this.storage.read<TreeNode>(`trees/${tree.id}/nodes/${nodeId}.json`);
      if (node) {
        return node;
      }
    }

    return null;
  }

  /**
   * Get a node from a specific tree
   */
  async getNodeFromTree(treeId: string, nodeId: string): Promise<TreeNode | null> {
    return await this.storage.read<TreeNode>(`trees/${treeId}/nodes/${nodeId}.json`);
  }

  /**
   * Get all children of a node
   */
  async getChildren(nodeId: string): Promise<TreeNode[]> {
    const node = await this.getNode(nodeId);
    if (!node) {
      return [];
    }

    const allNodeFiles = await this.storage.list(`trees/${node.treeId}/nodes`);
    const children: TreeNode[] = [];

    for (const file of allNodeFiles) {
      if (!file.endsWith('.json')) continue;

      const childNode = await this.storage.read<TreeNode>(`trees/${node.treeId}/nodes/${file}`);
      if (childNode && childNode.parentId === nodeId) {
        children.push(childNode);
      }
    }

    // Sort by sortOrder
    return children.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Get all nodes in a tree
   */
  async getAllNodes(treeId: string): Promise<TreeNode[]> {
    const nodeFiles = await this.storage.list(`trees/${treeId}/nodes`);
    const nodes: TreeNode[] = [];

    for (const file of nodeFiles) {
      if (!file.endsWith('.json')) continue;

      const node = await this.storage.read<TreeNode>(`trees/${treeId}/nodes/${file}`);
      if (node) {
        nodes.push(node);
      }
    }

    return nodes;
  }

  /**
   * Delete a node
   */
  async deleteNode(nodeId: string): Promise<void> {
    const node = await this.getNode(nodeId);
    if (!node) {
      return;
    }

    await this.storage.delete(`trees/${node.treeId}/nodes/${nodeId}.json`);
  }

  /**
   * Move a node to a new parent
   */
  async moveNode(nodeId: string, newParentId: string): Promise<TreeNode> {
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const newParent = await this.getNode(newParentId);
    if (!newParent) {
      throw new Error(`Parent node not found: ${newParentId}`);
    }

    if (node.treeId !== newParent.treeId) {
      throw new Error('Cannot move node to a different tree');
    }

    // Update node's parent and path
    node.parentId = newParentId;
    node.path = `${newParent.path}${node.id}/`;
    node.updatedAt = new Date().toISOString();

    await this.saveNode(node);

    return node;
  }

  /**
   * Find nodes by content ID
   */
  async findNodesByContent(contentId: string): Promise<TreeNode[]> {
    const trees = await this.listTrees();
    const matchingNodes: TreeNode[] = [];

    for (const tree of trees) {
      const nodes = await this.getAllNodes(tree.id);
      for (const node of nodes) {
        if (node.contentId === contentId) {
          matchingNodes.push(node);
        }
      }
    }

    return matchingNodes;
  }
}
