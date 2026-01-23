import { useState } from "react";
import { ChevronRight, ChevronDown, FileText, Folder, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";

// Matches the new strict taxonomy types
export type NodeType = 'folder' | 'document' | 'fragment';
export type ContentEditMode = 'editable' | 'readonly';

export interface TreeNode {
    id: string;
    parentId: string | null;
    path: string;
    type: NodeType;
    title: string;           // User-facing label
    gist: string;            // AI summary / readme
    contentId?: string;      // Only for document/fragment
    editMode?: ContentEditMode;  // Whether content is editable
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

    // Default expansion:
    // - All folders: expanded (to show full hierarchy)
    // - Documents: closed (fragments inside are implementation detail)
    const defaultOpen = node.type === 'folder';
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const isSelected = selectedId === node.id;

    // Icon based on type
    const getIcon = () => {
        switch (node.type) {
            case 'folder':
                return <Folder size={14} fill="currentColor" className="opacity-20" />;
            case 'document':
                return <FileText size={14} />;
            case 'fragment':
                return <Puzzle size={14} />;
        }
    };

    // Color based on type and edit mode
    const getColorClass = () => {
        // Editable content nodes are green
        if (node.editMode === 'editable') {
            return "text-emerald-500";
        }
        switch (node.type) {
            case 'folder':
                return "text-blue-500";
            case 'document':
                return "text-zinc-600";
            case 'fragment':
                return "text-amber-500";
        }
    };

    return (
        <div className="select-none font-medium">
            <div
                className={cn(
                    "flex flex-col py-1.5 px-2 cursor-pointer transition-colors border-l-2 rounded-r-md group",
                    isSelected
                        ? "bg-purple-50 border-purple-600"
                        : "border-transparent hover:bg-zinc-50"
                )}
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(node);
                    if (hasChildren) setIsOpen(!isOpen);
                }}
            >
                {/* Main Row: Expander + Icon + Title */}
                <div className="flex items-center">
                    {/* Expander */}
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
                        {hasChildren && (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                    </span>

                    {/* Icon */}
                    <span className={cn("mr-2 shrink-0", getColorClass())}>
                        {getIcon()}
                    </span>

                    {/* Title */}
                    <span className={cn(
                        "truncate text-sm",
                        isSelected ? "text-purple-900" : "text-zinc-700"
                    )}>
                        {node.title}
                    </span>
                </div>

                {/* Gist (sub-line) - shown on hover or when selected */}
                <div className={cn(
                    "text-[10px] text-zinc-400 pl-7 truncate mt-0.5 font-normal",
                    !isSelected && "hidden group-hover:block"
                )}>
                    {node.gist}
                </div>
            </div>

            {/* Children */}
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
