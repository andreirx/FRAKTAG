import { TreeStore } from './TreeStore.js';
import { VectorStore } from './VectorStore.js';
import { TreeNode } from './types.js';
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

        // Use TreeStore's native move logic
        await this.treeStore.moveNode(nodeId, newParentId);

        // We might want to update the vector index if the path is part of the embedding,
        // but currently we embed "Gist + Content", so moving doesn't invalidate the vector signature.
        // However, we DO need to save the tree state.

        // Note: TreeStore.moveNode saves the node, but we should ensure the tree file is synced if needed.
        // Since our TreeStore saves the whole file on saveNode, we are good.

        return `Moved "${node.l0Gist}" to parent "${newParent.l0Gist}"`;
    }

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
        const anchorParent = anchorParentId ? await this.treeStore.getNodeFromTree(treeId, anchorParentId) : null;
        const parentPath = anchorParent ? anchorParent.path : '/';

        // Create Container
        const containerId = randomUUID();
        const container: TreeNode = {
            id: containerId,
            treeId,
            parentId: anchorParentId,
            path: `${parentPath}${containerId}`,
            contentId: null,
            l0Gist: newParentName,
            l1Map: null,
            sortOrder: nodes[0].sortOrder,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await this.treeStore.saveNode(container);
        await this.vectorStore.add(containerId, `Category: ${newParentName}`);

        // Move Children
        for (const node of nodes) {
            node.parentId = containerId;
            node.path = `${container.path}/${node.id}`;
            node.updatedAt = new Date().toISOString();
            await this.treeStore.saveNode(node);
        }

        await this.vectorStore.save(treeId);
        return `Clustered ${nodes.length} nodes under "${newParentName}"`;
    }

    private async pruneNode(treeId: string, nodeId: string): Promise<string> {
        await this.treeStore.deleteNode(nodeId);
        await this.vectorStore.remove(nodeId);
        await this.vectorStore.save(treeId);
        return `Deleted node ${nodeId}`;
    }

    private async renameNode(treeId: string, nodeId: string, newName: string): Promise<string> {
        const node = await this.treeStore.getNodeFromTree(treeId, nodeId);
        if (!node) throw new Error(`Node ${nodeId} not found`);

        const oldName = node.l0Gist;
        node.l0Gist = newName;
        node.updatedAt = new Date().toISOString();

        await this.vectorStore.remove(nodeId);
        await this.vectorStore.add(nodeId, `Gist: ${newName}\n(Renamed from ${oldName})`);

        await this.treeStore.saveNode(node);
        await this.vectorStore.save(treeId);

        return `Renamed "${oldName.slice(0,20)}..." to "${newName}"`;
    }
}
