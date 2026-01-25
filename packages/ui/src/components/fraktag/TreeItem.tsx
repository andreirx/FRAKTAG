import { useState } from "react";
import { ChevronRight, ChevronDown, FileText, Folder, Puzzle, FolderPlus, FilePlus } from "lucide-react";
import { cn } from "@/lib/utils";

export type NodeType = 'folder' | 'document' | 'fragment';
export type ContentEditMode = 'editable' | 'readonly';

export interface TreeNode {
    id: string;
    parentId: string | null;
    path: string;
    type: NodeType;
    title: string;
    gist: string;
    contentId?: string;
    editMode?: ContentEditMode;
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
            case 'folder': return <Folder size={14} fill="currentColor" className="opacity-20" />;
            case 'document': return <FileText size={14} />;
            case 'fragment': return <Puzzle size={14} />;
        }
    };

    const getColorClass = () => {
        if (node.editMode === 'editable') return "text-emerald-500";
        switch (node.type) {
            case 'folder': return "text-blue-500";
            case 'document': return "text-zinc-600";
            case 'fragment': return "text-amber-500";
        }
    };

    return (
        <div className="w-full select-none font-medium text-sm block">
            {/*
                THE GRID CONTAINER
                - relative: For absolute button positioning
                - grid: Strict columns
                - minmax(0, 1fr): The Magic Spell. Forces text col to shrink to 0 width if needed.
                - pr-12: Padding right creates the "No Fly Zone" for text, so it doesn't run under buttons.
            */}
            <div
                className={cn(
                    "relative grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-2 items-start py-1.5 pr-12 cursor-pointer transition-colors border-l-2 rounded-r-md group",
                    isSelected
                        ? "bg-purple-50 border-purple-600"
                        : "border-transparent hover:bg-zinc-50"
                )}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(node);
                    if (hasChildren) setIsOpen(!isOpen);
                }}
            >
                {/* COL 1: Expander */}
                <div
                    className="flex items-center justify-center w-4 h-5 hover:bg-zinc-200 rounded transition-colors cursor-pointer shrink-0 mt-0.5"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (hasChildren) setIsOpen(!isOpen);
                    }}
                >
                    {hasChildren && (
                        isOpen ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />
                    )}
                </div>

                {/* COL 2: Icon */}
                <div className={cn("flex items-center justify-center h-5 shrink-0 mt-0.5", getColorClass())}>
                    {getIcon()}
                </div>

                {/* COL 3: Text Stack (Title + Gist) */}
                {/* min-w-0 here is critical for the child truncates to work inside the grid cell */}
                <div className="flex flex-col min-w-0">
                    {/* Title */}
                    <div className={cn(
                        "truncate font-medium leading-tight",
                        isSelected ? "text-purple-900" : "text-zinc-700"
                    )}>
                        {node.title}
                    </div>

                    {/* Gist */}
                    <div className={cn(
                        "truncate text-[10px] text-zinc-400 font-normal mt-0.5",
                        !isSelected && "hidden group-hover:block"
                    )}>
                        {node.gist}
                    </div>
                </div>

                {/*
                    ABSOLUTE LAYER: Buttons
                    They float over the right-side padding area.
                    They are NOT part of the grid flow.
                */}
                {isFolder && (canCreateFolder || canCreateContent) && (
                    <div className="absolute right-1 top-1.5 hidden group-hover:flex items-center gap-1 z-20">
                        {/* Wrapper with background ensures clean edges */}
                        <div className="flex items-center bg-white/90 backdrop-blur-[2px] shadow-sm border border-zinc-200 rounded-md p-0.5">
                            {canCreateFolder && onCreateFolder && (
                                <button
                                    className="p-1 rounded hover:bg-blue-50 text-zinc-400 hover:text-blue-600 transition-colors"
                                    title="New Folder"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCreateFolder(node.id);
                                    }}
                                >
                                    <FolderPlus size={13} />
                                </button>
                            )}
                            {canCreateContent && onCreateContent && (
                                <button
                                    className="p-1 rounded hover:bg-emerald-50 text-zinc-400 hover:text-emerald-600 transition-colors"
                                    title="New Editable Content"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCreateContent(node.id);
                                    }}
                                >
                                    <FilePlus size={13} />
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Recursive Children */}
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
