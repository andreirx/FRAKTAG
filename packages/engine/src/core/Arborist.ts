// packages/engine/src/core/Arborist.ts
// Tree Maintenance - Updated for Strict Taxonomy

import { TreeStore } from './TreeStore.js';
import { VectorStore } from './VectorStore.js';
import { TreeNode, FolderNode } from './types.js';
import { randomUUID } from 'crypto';

export type TreeOperation =
    | { action: 'CLUSTER'; targetNodeIds: string[]; newParentName: string }
    | { action: 'PRUNE'; targetNodeId: string }
    | { action: 'RENAME'; targetNodeId: string; newName: string }
    | { action: 'MOVE'; targetNodeId: string; newParentId: string };

export class Arborist {
    constructor(
        private treeStore: TreeStore,
        private vectorStore: VectorStore
    ) {}

    async execute(treeId: string, operation: TreeOperation): Promise<string> {
        switch (operation.action) {
            case 'CLUSTER':
                return this.clusterNodes(treeId, operation.targetNodeIds, operation.newParentName);
            case 'PRUNE':
                return this.pruneNode(treeId, operation.targetNodeId);
            case 'RENAME':
                return this.renameNode(treeId, operation.targetNodeId, operation.newName);
            case 'MOVE':
                return this.moveNode(treeId, operation.targetNodeId, operation.newParentId);
            default:
                throw new Error(`Unknown operation: ${(operation as any).action}`);
        }
    }

    /**
     * MOVE: Re-parents a node to a better location.
     */
    private async moveNode(treeId: string, nodeId: string, newParentId: string): Promise<string> {
        const node = await this.treeStore.getNodeFromTree(treeId, nodeId);
        if (!node) throw new Error(`Node ${nodeId} not found`);

        const newParent = await this.treeStore.getNodeFromTree(treeId, newParentId);
        if (!newParent) throw new Error(`Target Parent ${newParentId} not found`);

        await this.treeStore.moveNode(nodeId, newParentId);

        return `Moved "${node.title}" to parent "${newParent.title}"`;
    }

    /**
     * CLUSTER: Group multiple nodes under a new folder.
     * Note: This may fail if nodes are of different types (folders vs documents).
     */
    private async clusterNodes(treeId: string, targetIds: string[], newParentName: string): Promise<string> {
        const nodes: TreeNode[] = [];
        for (const id of targetIds) {
            const node = await this.treeStore.getNodeFromTree(treeId, id);
            if (!node) throw new Error(`Node ${id} not found in tree ${treeId}`);
            nodes.push(node);
        }

        if (nodes.length === 0) return "No nodes to cluster";

        // Anchor to the first node's parent
        const anchorParentId = nodes[0].parentId;
        if (!anchorParentId) throw new Error("Cannot cluster root nodes");

        const anchorParent = await this.treeStore.getNodeFromTree(treeId, anchorParentId);
        if (!anchorParent) throw new Error("Parent not found");

        // Create new folder container
        const folder = await this.treeStore.createFolder(
            treeId,
            anchorParentId,
            newParentName,
            `Container for clustered nodes: ${nodes.map(n => n.title).join(', ').slice(0, 100)}`
        );

        await this.vectorStore.add(folder.id, `Category: ${newParentName}`);

        // Move children to new folder
        for (const node of nodes) {
            try {
                await this.treeStore.moveNode(node.id, folder.id);
            } catch (e: any) {
                console.warn(`Could not move node ${node.id}: ${e.message}`);
            }
        }

        await this.vectorStore.save(treeId);
        return `Clustered ${nodes.length} nodes under "${newParentName}"`;
    }

    private async pruneNode(treeId: string, nodeId: string): Promise<string> {
        const node = await this.treeStore.getNodeFromTree(treeId, nodeId);
        const nodeName = node?.title || nodeId;

        await this.treeStore.deleteNode(nodeId);
        await this.vectorStore.removeByNodeId(nodeId);
        await this.vectorStore.save(treeId);

        return `Deleted node "${nodeName}"`;
    }

    private async renameNode(treeId: string, nodeId: string, newName: string): Promise<string> {
        const node = await this.treeStore.getNodeFromTree(treeId, nodeId);
        if (!node) throw new Error(`Node ${nodeId} not found`);

        const oldName = node.title;
        node.title = newName;
        node.updatedAt = new Date().toISOString();

        await this.vectorStore.removeByNodeId(nodeId);
        await this.vectorStore.add(nodeId, `Title: ${newName}\nGist: ${node.gist}`);

        await this.treeStore.saveNode(node);
        await this.vectorStore.save(treeId);

        return `Renamed "${oldName.slice(0, 20)}..." to "${newName}"`;
    }
}
