import { useState } from "react";
import { ChevronRight, ChevronDown, FileText, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

// Define the shape of a node as it comes from your API
// Update the interface to include parentId and sortOrder
export interface TreeNode {
    id: string;
    parentId: string | null;
    path: string;
    l0Gist: string;
    l1Map?: { summary: string } | null;
    contentId?: string | null;
    sortOrder?: number;
}

interface TreeItemProps {
    node: TreeNode;
    childrenMap: Record<string, TreeNode[]>; // Map of parentId -> children
    onSelect: (node: TreeNode) => void;
    selectedId?: string;
    depth?: number;
}

export function TreeItem({ node, childrenMap, onSelect, selectedId, depth = 0 }: TreeItemProps) {
    const children = childrenMap[node.id] || [];
    const hasChildren = children.length > 0;

    // Auto-expand root (depth 0)
    const [isOpen, setIsOpen] = useState(depth === 0);

    const isFolder = !node.contentId;
    const isSelected = selectedId === node.id;

    return (
        <div className="select-none text-sm">
            <div
                className={cn(
                    "flex items-center py-1.5 px-2 cursor-pointer transition-colors border-l-2",
                    isSelected
                        ? "bg-zinc-100 border-zinc-900 font-medium"
                        : "border-transparent hover:bg-zinc-50 text-zinc-600 hover:text-zinc-900"
                )}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(node);
                    if (hasChildren) setIsOpen(!isOpen);
                }}
            >
        <span className="mr-1 shrink-0 opacity-50 w-4 h-4 flex items-center justify-center">
          {hasChildren && (
              isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          )}
        </span>

                <span className={cn("mr-2 shrink-0", isFolder ? "text-blue-500" : "text-amber-500")}>
           {isFolder ? <Folder size={14} /> : <FileText size={14} />}
        </span>

                <span className="truncate">
          {node.l0Gist}
        </span>
            </div>

            {isOpen && hasChildren && (
                <div>
                    {children.map((child) => (
                        <TreeItem
                            key={child.id}
                            node={child}
                            childrenMap={childrenMap}
                            onSelect={onSelect}
                            selectedId={selectedId}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
