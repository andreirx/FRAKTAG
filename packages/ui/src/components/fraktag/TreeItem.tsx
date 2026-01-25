import { useState } from "react";
import { ChevronRight, ChevronDown, FileText, Folder, Puzzle, FolderPlus, FilePlus } from "lucide-react";
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
    onCreateFolder?: (parentId: string) => void;
    onCreateContent?: (parentId: string) => void;
}

export function TreeItem({ node, childrenMap, onSelect, selectedId, depth = 0, onCreateFolder, onCreateContent }: TreeItemProps) {
    const children = childrenMap[node.id] || [];
    const hasChildren = children.length > 0;

    // Default expansion:
    // - All folders: expanded (to show full hierarchy)
    // - Documents: closed (fragments inside are implementation detail)
    const defaultOpen = node.type === 'folder';
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const isSelected = selectedId === node.id;

    // Determine what kind of children this folder has
    const hasFolderChildren = children.some(c => c.type === 'folder');
    const hasContentChildren = children.some(c => c.type === 'document' || c.type === 'fragment');

    // Show inline actions on ALL folders
    const isFolder = node.type === 'folder';
    // But only allow actions that make sense:
    // - Can create folder if no content children (would mix types)
    // - Can create content if no folder children (would mix types)
    const canCreateFolder = !hasContentChildren;
    const canCreateContent = !hasFolderChildren;

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
        <div className="select-none font-medium overflow-hidden w-full">
            <div
                className={cn(
                    "flex flex-col py-1.5 px-2 cursor-pointer transition-colors border-l-2 rounded-r-md group overflow-hidden w-full",
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
                {/* Main Row: Expander + Icon + Title + Inline Actions */}
                <div className="flex items-center min-w-0 overflow-hidden w-full">
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
                        "truncate text-sm flex-1 min-w-0",
                        isSelected ? "text-purple-900" : "text-zinc-700"
                    )}>
                        {node.title}
                    </span>

                    {/* Inline Actions - shown on hover for folders */}
                    {isFolder && (
                        <div className="hidden group-hover:flex items-center gap-0.5 ml-1 shrink-0">
                            {canCreateFolder && onCreateFolder && (
                                <button
                                    className="p-0.5 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-700"
                                    title="New Folder"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCreateFolder(node.id);
                                    }}
                                >
                                    <FolderPlus size={14} />
                                </button>
                            )}
                            {canCreateContent && onCreateContent && (
                                <button
                                    className="p-0.5 rounded hover:bg-emerald-100 text-emerald-500 hover:text-emerald-700"
                                    title="New Editable Content"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCreateContent(node.id);
                                    }}
                                >
                                    <FilePlus size={14} />
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Gist (sub-line) - shown on hover or when selected */}
                <div className={cn(
                    "text-[10px] text-zinc-400 pl-7 mt-0.5 font-normal overflow-hidden text-ellipsis whitespace-nowrap max-w-full",
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
                            onCreateFolder={onCreateFolder}
                            onCreateContent={onCreateContent}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
