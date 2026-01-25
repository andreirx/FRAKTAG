// packages/engine/src/core/TreeStore.ts
// STRICT TAXONOMY GATEKEEPER

import {
  Tree,
  TreeNode,
  TreeConfig,
  FolderNode,
  DocumentNode,
  FragmentNode,
  NodeType,
  SeedFolder,
  ContentEditMode,
  isFolder,
  isDocument,
  isFragment,
  hasContent
} from './types.js';
import { JsonStorage } from '../adapters/storage/JsonStorage.js';
import { randomUUID } from 'crypto';

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

  // ============ LOAD / SAVE ============

  private async loadTreeFile(treeId: string): Promise<TreeFile> {
    if (this.cache.has(treeId)) return this.cache.get(treeId)!;

    const file = await this.storage.read<TreeFile>(`trees/${treeId}.json`);
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

  // ============ TREE EXISTENCE CHECK ============

  async treeExists(treeId: string): Promise<boolean> {
    return this.storage.exists(`trees/${treeId}.json`);
  }

  // ============ TREE CREATION ============

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
      kbId: config.kbId, // Track which KB owns this tree
    };

    const rootNode: FolderNode = {
      id: rootNodeId,
      treeId: config.id,
      parentId: null,
      path: '/',
      type: 'folder',
      title: config.name,
      gist: config.organizingPrinciple,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    };

    const treeFile: TreeFile = {
      config: treeMeta,
      nodes: { [rootNodeId]: rootNode }
    };

    // Create seed folders if specified
    if (config.seedFolders && config.seedFolders.length > 0) {
      await this.createSeedFolders(treeFile, config.id, rootNodeId, '/', config.seedFolders);
    }

    await this.saveTreeFile(config.id, treeFile);
    return treeMeta;
  }

  private async createSeedFolders(
    treeFile: TreeFile,
    treeId: string,
    parentId: string,
    parentPath: string,
    seeds: SeedFolder[]
  ): Promise<void> {
    const now = new Date().toISOString();

    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      // Use just the title slug for the nodeId, not concatenated with parentId
      const titleSlug = seed.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const nodeId = `seed-${titleSlug}-${randomUUID().slice(0, 8)}`;
      const path = `${parentPath}${nodeId}/`;

      const folderNode: FolderNode = {
        id: nodeId,
        treeId,
        parentId,
        path,
        type: 'folder',
        title: seed.title,
        gist: seed.gist,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
      };

      treeFile.nodes[nodeId] = folderNode;

      // Recursively create children
      if (seed.children && seed.children.length > 0) {
        await this.createSeedFolders(treeFile, treeId, nodeId, path, seed.children);
      }
    }
  }

  // ============ TREE QUERIES ============

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

  async getAllNodes(treeId: string): Promise<TreeNode[]> {
    const file = await this.loadTreeFile(treeId);
    return Object.values(file.nodes);
  }

  async getTreeFile(treeId: string): Promise<TreeFile> {
    return await this.loadTreeFile(treeId);
  }

  // ============ THE GATEKEEPER: STRICT VALIDATION ============

  /**
   * Validates if a parent can accept a specific type of child based on STRICT constraints.
   *
   * Rules:
   * 1. Folders can contain EITHER Folders OR Documents (not both)
   * 2. Documents can ONLY contain Fragments
   * 3. Fragments can ONLY contain other Fragments
   * 4. Folders cannot contain Fragments directly
   */
  async validateParentChild(parentId: string, childType: NodeType, treeId: string): Promise<void> {
    const file = await this.loadTreeFile(treeId);
    const parent = file.nodes[parentId];

    if (!parent) {
      throw new Error(`Parent node ${parentId} not found.`);
    }

    // Rule: Documents can ONLY contain Fragments
    if (isDocument(parent)) {
      if (childType !== 'fragment') {
        throw new Error(
          `Strict Violation: Document "${parent.title}" can ONLY contain Fragments, not ${childType}s.`
        );
      }
      return; // Valid: Document → Fragment
    }

    // Rule: Fragments can ONLY contain other Fragments
    if (isFragment(parent)) {
      if (childType !== 'fragment') {
        throw new Error(
          `Strict Violation: Fragment "${parent.title}" can ONLY contain other Fragments, not ${childType}s.`
        );
      }
      return; // Valid: Fragment → Fragment
    }

    // Rule: Folders cannot contain Fragments directly
    if (isFolder(parent)) {
      if (childType === 'fragment') {
        throw new Error(
          `Strict Violation: Folder "${parent.title}" cannot contain Fragments directly. ` +
          `Fragments must be children of Documents.`
        );
      }

      // Check existing children to enforce Branch/Leaf constraint
      const children = Object.values(file.nodes).filter(n => n.parentId === parentId);

      if (children.length > 0) {
        const hasFolderChildren = children.some(c => isFolder(c));
        const hasDocumentChildren = children.some(c => isDocument(c));

        if (childType === 'folder' && hasDocumentChildren) {
          throw new Error(
            `Strict Violation: Folder "${parent.title}" is a Leaf Folder (contains Documents). ` +
            `Cannot add a Folder to it. Leaf Folders can only contain Documents.`
          );
        }

        if (childType === 'document' && hasFolderChildren) {
          throw new Error(
            `Strict Violation: Folder "${parent.title}" is a Branch Folder (contains Sub-Folders). ` +
            `Cannot add a Document to it. Documents can only be placed in Leaf Folders.`
          );
        }
      }

      return; // Valid: Folder → Folder OR Folder → Document
    }
  }

  /**
   * Get folder type (Branch, Leaf, or Empty)
   */
  async getFolderType(nodeId: string): Promise<'branch' | 'leaf' | 'empty'> {
    const node = await this.getNode(nodeId);
    if (!node || !isFolder(node)) {
      throw new Error(`Node ${nodeId} is not a folder`);
    }

    const children = await this.getChildren(nodeId);
    if (children.length === 0) return 'empty';

    const hasSubfolders = children.some(c => isFolder(c));
    return hasSubfolders ? 'branch' : 'leaf';
  }

  /**
   * Get all leaf folders (folders that can accept Documents)
   */
  async getLeafFolders(treeId: string): Promise<FolderNode[]> {
    const file = await this.loadTreeFile(treeId);
    const folders = Object.values(file.nodes).filter(isFolder) as FolderNode[];

    const leafFolders: FolderNode[] = [];

    for (const folder of folders) {
      const children = Object.values(file.nodes).filter(n => n.parentId === folder.id);
      const hasSubfolders = children.some(c => isFolder(c));

      // A leaf folder is one that has no subfolders (may have documents or be empty)
      if (!hasSubfolders) {
        leafFolders.push(folder);
      }
    }

    return leafFolders;
  }

  // ============ NODE OPERATIONS ============

  async saveNode(node: TreeNode): Promise<void> {
    // Validate before saving (if has a parent)
    if (node.parentId) {
      await this.validateParentChild(node.parentId, node.type, node.treeId);
    }

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
    } catch {
      return null;
    }
  }

  async getChildren(nodeId: string): Promise<TreeNode[]> {
    const node = await this.getNode(nodeId);
    if (!node) return [];
    const file = await this.loadTreeFile(node.treeId);
    return Object.values(file.nodes)
      .filter(n => n.parentId === nodeId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async moveNode(nodeId: string, newParentId: string): Promise<TreeNode> {
    const node = await this.getNode(nodeId);
    if (!node) throw new Error("Node not found");

    // Validate the move
    await this.validateParentChild(newParentId, node.type, node.treeId);

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
      res.push(...Object.values(file.nodes).filter(n => hasContent(n) && n.contentId === contentId));
    }
    return res;
  }

  async deleteTree(treeId: string): Promise<void> {
    await this.storage.delete(`trees/${treeId}.json`);
    this.cache.delete(treeId);
  }

  async deleteNode(nodeId: string): Promise<void> {
    const node = await this.getNode(nodeId);
    if (!node) return;

    const file = await this.loadTreeFile(node.treeId);

    // Cascading delete: remove all children first
    const children = Object.values(file.nodes).filter(n => n.parentId === nodeId);
    for (const child of children) {
      await this.deleteNode(child.id);
    }

    delete file.nodes[nodeId];
    file.config.updatedAt = new Date().toISOString();

    await this.saveTreeFile(node.treeId, file);
  }

  clearCache(treeId?: string) {
    if (treeId) {
      this.cache.delete(treeId);
    } else {
      this.cache.clear();
    }
  }

  // ============ FOLDER CREATION HELPERS ============

  /**
   * Create a new folder under a parent
   */
  async createFolder(
    treeId: string,
    parentId: string,
    title: string,
    gist: string
  ): Promise<FolderNode> {
    // Validate parent can accept a folder
    await this.validateParentChild(parentId, 'folder', treeId);

    const file = await this.loadTreeFile(treeId);
    const parent = file.nodes[parentId];
    if (!parent) throw new Error(`Parent ${parentId} not found`);

    const now = new Date().toISOString();
    const nodeId = `${parentId}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    // Check if already exists
    if (file.nodes[nodeId]) {
      return file.nodes[nodeId] as FolderNode;
    }

    const siblings = Object.values(file.nodes).filter(n => n.parentId === parentId);

    const folder: FolderNode = {
      id: nodeId,
      treeId,
      parentId,
      path: `${parent.path}${nodeId}/`,
      type: 'folder',
      title,
      gist,
      sortOrder: siblings.length,
      createdAt: now,
      updatedAt: now,
    };

    file.nodes[nodeId] = folder;
    file.config.updatedAt = now;
    await this.saveTreeFile(treeId, file);

    return folder;
  }

  /**
   * Create a document node under a leaf folder
   */
  async createDocument(
    treeId: string,
    parentId: string,
    title: string,
    gist: string,
    contentId: string,
    editMode: ContentEditMode = 'readonly'
  ): Promise<DocumentNode> {
    // Validate parent can accept a document
    await this.validateParentChild(parentId, 'document', treeId);

    const file = await this.loadTreeFile(treeId);
    const parent = file.nodes[parentId];
    if (!parent) throw new Error(`Parent ${parentId} not found`);

    const now = new Date().toISOString();
    const nodeId = randomUUID();
    const siblings = Object.values(file.nodes).filter(n => n.parentId === parentId);

    const doc: DocumentNode = {
      id: nodeId,
      treeId,
      parentId,
      path: `${parent.path}${nodeId}/`,
      type: 'document',
      title,
      gist,
      contentId,
      editMode,
      sortOrder: siblings.length,
      createdAt: now,
      updatedAt: now,
    };

    file.nodes[nodeId] = doc;
    file.config.updatedAt = now;
    await this.saveTreeFile(treeId, file);

    return doc;
  }

  /**
   * Create a fragment node under a document or another fragment
   */
  async createFragment(
    treeId: string,
    parentId: string,
    title: string,
    gist: string,
    contentId: string,
    editMode: ContentEditMode = 'readonly'
  ): Promise<FragmentNode> {
    // Validate parent can accept a fragment
    await this.validateParentChild(parentId, 'fragment', treeId);

    const file = await this.loadTreeFile(treeId);
    const parent = file.nodes[parentId];
    if (!parent) throw new Error(`Parent ${parentId} not found`);

    const now = new Date().toISOString();
    const nodeId = randomUUID();
    const siblings = Object.values(file.nodes).filter(n => n.parentId === parentId);

    const fragment: FragmentNode = {
      id: nodeId,
      treeId,
      parentId,
      path: `${parent.path}${nodeId}/`,
      type: 'fragment',
      title,
      gist,
      contentId,
      editMode,
      sortOrder: siblings.length,
      createdAt: now,
      updatedAt: now,
    };

    file.nodes[nodeId] = fragment;
    file.config.updatedAt = now;
    await this.saveTreeFile(treeId, file);

    return fragment;
  }

  // ============ VISUALIZATION ============

  async generateVisualTree(treeId: string): Promise<string> {
    const file = await this.loadTreeFile(treeId);
    const root = file.nodes[file.config.rootNodeId];
    if (!root) return "Empty Tree";

    let output = `${root.title} [${root.gist.slice(0, 50)}${root.gist.length > 50 ? '...' : ''}]\n`;
    const children = Object.values(file.nodes)
      .filter(n => n.parentId === root.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    output += this.drawChildren(file.nodes, children, "");
    return output;
  }

  private drawChildren(
    allNodes: Record<string, TreeNode>,
    nodes: TreeNode[],
    prefix: string
  ): string {
    let output = "";

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isLast = i === nodes.length - 1;
      const connector = isLast ? "└── " : "├── ";

      // Icon based on type
      let icon = "📂";
      if (node.type === 'document') icon = "📄";
      if (node.type === 'fragment') icon = "🧩";

      const cleanTitle = node.title.replace(/\n/g, ' ').slice(0, 40);
      const titleSuffix = node.title.length > 40 ? "..." : "";
      const gistPreview = node.gist.slice(0, 30).replace(/\n/g, ' ');

      output += `${prefix}${connector}${icon} ${cleanTitle}${titleSuffix} [${gistPreview}...]\n`;

      const children = Object.values(allNodes)
        .filter(n => n.parentId === node.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      if (children.length > 0) {
        const childPrefix = prefix + (isLast ? "    " : "│   ");
        output += this.drawChildren(allNodes, children, childPrefix);
      }
    }
    return output;
  }

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
    const typeTag = currentNode.type.toUpperCase().slice(0, 3);
    let output = `${indent}[${currentNode.id}] (${typeTag}) ${currentNode.title}: ${currentNode.gist}\n`;

    const children = Object.values(allNodes)
      .filter(n => n.parentId === currentNode.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    for (const child of children) {
      output += this.buildMapRecursive(allNodes, child, depth + 1);
    }
    return output;
  }

  async getTreeStats(treeId: string): Promise<{
    maxDepth: number;
    totalNodes: number;
    folderCount: number;
    documentCount: number;
    fragmentCount: number;
  }> {
    const file = await this.loadTreeFile(treeId);
    const nodes = Object.values(file.nodes);

    let maxDepth = 0;
    let folderCount = 0;
    let documentCount = 0;
    let fragmentCount = 0;

    for (const node of nodes) {
      const segments = node.path.split('/').filter(p => p.length > 0);
      const depth = segments.length;
      if (depth > maxDepth) maxDepth = depth;

      if (isFolder(node)) folderCount++;
      else if (isDocument(node)) documentCount++;
      else if (isFragment(node)) fragmentCount++;
    }

    return {
      maxDepth: Math.max(1, maxDepth),
      totalNodes: nodes.length,
      folderCount,
      documentCount,
      fragmentCount
    };
  }
}
