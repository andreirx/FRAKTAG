import { useState } from "react";
import { ChevronRight, ChevronDown, FileText, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

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
    childrenMap: Record<string, TreeNode[]>;
    onSelect: (node: TreeNode) => void;
    selectedId?: string;
    depth?: number;
}

export function TreeItem({ node, childrenMap, onSelect, selectedId, depth = 0 }: TreeItemProps) {
    const children = childrenMap[node.id] || [];
    const hasChildren = children.length > 0;

    // Logic: It's a folder if it has children OR if it has no content.
    const isFolder = hasChildren || !node.contentId;

    // FIX: Auto-expand top 4 levels so the tree feels "open" by default
    const [isOpen, setIsOpen] = useState(depth < 4);
    const isSelected = selectedId === node.id;

    return (
        <div className="select-none text-sm font-medium">
            <div
                className={cn(
                    "flex items-center py-1.5 px-2 cursor-pointer transition-colors border-l-2 rounded-r-md",
                    isSelected
                        ? "bg-zinc-100 border-purple-600 text-purple-900"
                        : "border-transparent hover:bg-zinc-50 text-zinc-600 hover:text-zinc-900"
                )}
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(node);
                    // Toggle open/close only if it acts as a folder (has children)
                    if (hasChildren) setIsOpen(!isOpen);
                }}
            >
        <span
            className={cn(
                "mr-1 shrink-0 w-4 h-4 flex items-center justify-center transition-transform hover:bg-zinc-200 rounded",
                !hasChildren && "opacity-0"
            )}
            onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) setIsOpen(!isOpen);
            }}
        >
          {hasChildren && (
              isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          )}
        </span>

                <span className={cn("mr-2 shrink-0", isFolder ? "text-blue-500" : "text-amber-500")}>
           {isFolder ? <Folder size={14} fill="currentColor" className="opacity-20" /> : <FileText size={14} />}
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
