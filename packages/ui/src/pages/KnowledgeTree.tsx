import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import axios from 'axios';
import { TreeItem, TreeNode } from "@/components/fraktag/TreeItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, RefreshCw, Database, FileText, Folder, Puzzle, ChevronDown, X, Plus, FolderPlus, Check, Move, Sparkles, Library, History, Lock, Unlock, FilePlus, Wand2, Trash2, MessageSquare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { IngestionDialog } from "@/components/fraktag/IngestionDialog";
import { QueryDialog } from "@/components/fraktag/QueryDialog";
import { ChatDialog } from "@/components/fraktag/ChatDialog";
import { MoveDialog } from "@/components/fraktag/MoveDialog";
import { KBManagerDialog } from "@/components/fraktag/KBManagerDialog";
import { CreateFolderDialog } from "@/components/fraktag/CreateFolderDialog";
import { CreateNoteDialog } from "@/components/fraktag/CreateNoteDialog";
import { DeleteNodeDialog } from "@/components/fraktag/DeleteNodeDialog";
import { ReplaceVersionDialog } from "@/components/fraktag/ReplaceVersionDialog";
import { MarkdownRenderer } from "@/components/fraktag/MarkdownRenderer";
import { EditableContent } from "@/components/fraktag/EditableContent";

interface KnowledgeBase {
    id: string;
    name: string;
    path: string;
    organizingPrinciple: string;
    defaultTreeId: string;
}

export default function KnowledgeTree() {
    const [loading, setLoading] = useState(true);
    const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
    const [activeKbId, setActiveKbId] = useState<string | null>(null); // null means "Internal Knowledge Base"
    const [trees, setTrees] = useState<any[]>([]);
    const [activeTreeId, setActiveTreeId] = useState<string>("");
    const [rawData, setRawData] = useState<any>(null);
    const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
    const [searchTerm, setSearchTerm] = useState("");

    const [contentPayload, setContentPayload] = useState<string | null>(null);
    const [contentLoading, setContentLoading] = useState(false);
    const [contentError, setContentError] = useState(false);

    // Ingestion Dialog
    const [ingestionOpen, setIngestionOpen] = useState(false);

    // Auto-save Edit State
    const [editTitle, setEditTitle] = useState("");
    const [editGist, setEditGist] = useState("");
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Folder Creation Dialog
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const [createFolderParentId, setCreateFolderParentId] = useState<string>("");

    // Move Dialog
    const [moveDialogOpen, setMoveDialogOpen] = useState(false);
    const [moveNodeId, setMoveNodeId] = useState<string>("");
    const [moveNodeType, setMoveNodeType] = useState<string>("");

    // Query Dialog State
    const [queryDialogOpen, setQueryDialogOpen] = useState(false);
    const [chatDialogOpen, setChatDialogOpen] = useState(false);

    // KB Manager Dialog State
    const [kbManagerOpen, setKbManagerOpen] = useState(false);

    // Content Editing State
    const [editableContent, setEditableContent] = useState<string>("");
    const [contentSaveStatus, setContentSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const contentSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [contentEditMode, setContentEditMode] = useState<'editable' | 'readonly' | null>(null);

    // Version Replacement Dialog
    const [replaceVersionOpen, setReplaceVersionOpen] = useState(false);

    // Create Note Dialog
    const [createNoteOpen, setCreateNoteOpen] = useState(false);
    const [createNoteParentId, setCreateNoteParentId] = useState("");

    // Gist Generation
    const [generatingGist, setGeneratingGist] = useState(false);
    const previousNodeRef = useRef<TreeNode | null>(null);

    // Delete Node Dialog
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    // Sidebar Resize State
    const [sidebarWidth, setSidebarWidth] = useState(560);
    const isResizing = useRef(false);
    const startResizing = useCallback(() => { isResizing.current = true; }, []);
    const stopResizing = useCallback(() => { isResizing.current = false; }, []);
    const resize = useCallback((e: MouseEvent) => {
        if (isResizing.current) {
            const w = e.clientX;
            if (w > 250 && w < 1280) setSidebarWidth(w);
        }
    }, []);

    useEffect(() => {
        window.addEventListener("mousemove", resize);
        window.addEventListener("mouseup", stopResizing);
        return () => {
            window.removeEventListener("mousemove", resize);
            window.removeEventListener("mouseup", stopResizing);
        };
    }, [resize, stopResizing]);

    // Initial Load - Fetch KBs and Trees
    useEffect(() => {
        async function fetchData() {
            try {
                // Fetch knowledge bases
                const kbRes = await axios.get('/api/knowledge-bases');
                setKnowledgeBases(kbRes.data);

                // Fetch all trees
                const treeRes = await axios.get('/api/trees');
                setTrees(treeRes.data);
                if (treeRes.data.length > 0) setActiveTreeId(treeRes.data[0].id);
            } catch (e) {
                console.error("Failed to load data", e);
            }
        }
        fetchData();
    }, []);

    // Filter trees by active KB
    const filteredTrees = useMemo(() => {
        if (!activeKbId) {
            // "Internal Knowledge Base" - show trees without kbId
            return trees.filter(t => !t.kbId);
        }
        // Show trees belonging to the selected KB
        return trees.filter(t => t.kbId === activeKbId);
    }, [trees, activeKbId]);

    // When KB changes, switch to first tree from the new KB if current tree doesn't belong
    useEffect(() => {
        if (!activeTreeId) return;

        // Check if current tree belongs to the selected KB
        const currentTree = trees.find(t => t.id === activeTreeId);
        if (!currentTree) return;

        const treeMatchesKb = activeKbId
            ? currentTree.kbId === activeKbId
            : !currentTree.kbId; // Internal KB: tree should have no kbId

        // If current tree doesn't match, switch to first tree from the new KB
        if (!treeMatchesKb && filteredTrees.length > 0) {
            setActiveTreeId(filteredTrees[0].id);
            setSelectedNode(null);
        }
    }, [activeKbId, trees]);

    // Get active KB name
    const activeKbName = activeKbId
        ? knowledgeBases.find(kb => kb.id === activeKbId)?.name || "Unknown KB"
        : "Internal Knowledge Base";

    // Reload functions for after KB/tree creation
    const reloadKnowledgeBases = async () => {
        try {
            const kbRes = await axios.get('/api/knowledge-bases');
            setKnowledgeBases(kbRes.data);
        } catch (e) {
            console.error("Failed to reload KBs", e);
        }
    };

    const reloadTrees = async () => {
        try {
            const treeRes = await axios.get('/api/trees');
            setTrees(treeRes.data);
            // Reload current tree structure if active
            if (activeTreeId) {
                loadTreeStructure(activeTreeId);
            }
        } catch (e) {
            console.error("Failed to reload trees", e);
        }
    };

    useEffect(() => {
        if (activeTreeId) loadTreeStructure(activeTreeId);
    }, [activeTreeId]);

    // Auto-generate gist when navigating away from a node with content but no gist
    useEffect(() => {
        const prevNode = previousNodeRef.current;
        if (prevNode && prevNode.contentId && !prevNode.gist && contentPayload && contentPayload.trim().length > 10) {
            // Generate gist for the previous node
            generateGistForNode(prevNode.id, contentPayload);
        }
        previousNodeRef.current = selectedNode;
    }, [selectedNode]);

    // Content Fetching & Initialize Edit Fields
    useEffect(() => {
        setContentPayload(null);
        setEditableContent("");
        setContentError(false);
        setContentLoading(false);
        setSaveStatus("idle");
        setContentSaveStatus("idle");
        setContentEditMode(null);
        // Initialize edit fields with selected node's values
        if (selectedNode) {
            setEditTitle(selectedNode.title);
            setEditGist(selectedNode.gist);
            setContentEditMode(selectedNode.editMode || 'readonly');
        }
        if (selectedNode?.contentId) {
            fetchContent(selectedNode.contentId);
        }
    }, [selectedNode]);

    // Auto-save with debounce
    const autoSave = useCallback(async (title: string, gist: string) => {
        if (!selectedNode) return;
        // Don't save if nothing changed
        if (title === selectedNode.title && gist === selectedNode.gist) return;

        setSaveStatus("saving");
        try {
            const res = await axios.patch(`/api/nodes/${selectedNode.id}`, {
                title,
                gist,
            });
            // Update selected node with new data
            setSelectedNode(res.data);
            // Also update in rawData to reflect in tree
            if (rawData?.nodes) {
                setRawData({
                    ...rawData,
                    nodes: {
                        ...rawData.nodes,
                        [selectedNode.id]: res.data,
                    },
                });
            }
            setSaveStatus("saved");
            // Clear saved status after 2s
            setTimeout(() => setSaveStatus("idle"), 2000);
        } catch (e) {
            console.error("Failed to save:", e);
            setSaveStatus("error");
        }
    }, [selectedNode, rawData]);

    // Debounced save on title/gist changes
    const handleTitleChange = (newTitle: string) => {
        setEditTitle(newTitle);
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            autoSave(newTitle, editGist);
        }, 800);
    };

    const handleGistChange = (newGist: string) => {
        setEditGist(newGist);
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            autoSave(editTitle, newGist);
        }, 800);
    };

    // Folder Creation
    const openCreateFolderDialog = (parentId: string) => {
        setCreateFolderParentId(parentId);
        setCreateFolderOpen(true);
    };

    // Content Auto-Save (for editable content)
    const autoSaveContent = useCallback(async (content: string) => {
        if (!selectedNode?.contentId || contentEditMode !== 'editable') return;
        if (content === contentPayload) return; // No change

        setContentSaveStatus("saving");
        try {
            // Pass nodeId to also update vector index
            await axios.patch(`/api/content/${selectedNode.contentId}`, {
                payload: content,
                nodeId: selectedNode.id
            });
            setContentPayload(content);
            setContentSaveStatus("saved");
            setTimeout(() => setContentSaveStatus("idle"), 2000);
        } catch (e) {
            console.error("Failed to save content:", e);
            setContentSaveStatus("error");
        }
    }, [selectedNode, contentEditMode, contentPayload]);

    const handleContentChange = (newContent: string) => {
        setEditableContent(newContent);
        if (contentSaveTimeoutRef.current) clearTimeout(contentSaveTimeoutRef.current);
        contentSaveTimeoutRef.current = setTimeout(() => {
            autoSaveContent(newContent);
        }, 1000);
    };

    // Generate Gist for a node
    const generateGistForNode = async (nodeId: string, content: string) => {
        if (!content || content.trim().length < 10) return;
        try {
            const res = await axios.post('/api/generate/gist', {
                content: content.slice(0, 3000),
                treeId: activeTreeId
            });
            if (res.data.gist) {
                await axios.patch(`/api/nodes/${nodeId}`, { gist: res.data.gist });
            }
        } catch (e) {
            console.error("Failed to generate gist:", e);
        }
    };

    // Generate Gist for current node (on button click)
    const handleGenerateGist = async () => {
        if (!selectedNode || !contentPayload || contentPayload.trim().length < 10) return;
        setGeneratingGist(true);
        try {
            const genRes = await axios.post('/api/generate/gist', {
                content: contentPayload.slice(0, 3000),
                treeId: activeTreeId
            });
            if (genRes.data.gist) {
                setEditGist(genRes.data.gist);
                // Save to server and use the response
                const patchRes = await axios.patch(`/api/nodes/${selectedNode.id}`, { gist: genRes.data.gist });
                // Update selected node with server response
                setSelectedNode(patchRes.data);
                // Also update in rawData to reflect in tree
                if (rawData?.nodes) {
                    setRawData({
                        ...rawData,
                        nodes: {
                            ...rawData.nodes,
                            [selectedNode.id]: patchRes.data,
                        },
                    });
                }
            }
        } catch (e) {
            console.error("Failed to generate gist:", e);
        } finally {
            setGeneratingGist(false);
        }
    };

    // Create Note (editable document)
    const openCreateNoteDialog = (parentId: string) => {
        setCreateNoteParentId(parentId);
        setCreateNoteOpen(true);
    };

    // Move operations
    const openMoveDialog = (nodeId: string, nodeType: string) => {
        setMoveNodeId(nodeId);
        setMoveNodeType(nodeType);
        setMoveDialogOpen(true);
    };


    async function loadTreeStructure(id: string, selectNodeId?: string) {
        setLoading(true);
        try {
            const res = await axios.get(`/api/trees/${id}/structure`);
            setRawData(res.data);
            // If a node ID is provided, select it after loading; otherwise clear selection
            if (selectNodeId && res.data?.nodes?.[selectNodeId]) {
                setSelectedNode(res.data.nodes[selectNodeId]);
            } else if (!selectNodeId) {
                setSelectedNode(null);
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }

    async function fetchContent(id: string) {
        setContentLoading(true);
        try {
            const res = await axios.get(`/api/content/${encodeURIComponent(id)}`);
            setContentPayload(res.data.payload);
            setEditableContent(res.data.payload);
            // Get edit mode from content atom if available
            if (res.data.editMode) {
                setContentEditMode(res.data.editMode);
            }
        } catch (e) {
            setContentError(true);
        } finally {
            setContentLoading(false);
        }
    }

    // Memoized Tree Data & Search Results
    const { rootNode, childrenMap, flatList } = useMemo(() => {
        if (!rawData || !rawData.nodes) return { rootNode: null, childrenMap: {}, flatList: [] };

        const nodes = Object.values(rawData.nodes) as TreeNode[];
        const map: Record<string, TreeNode[]> = {};
        let root = null;

        nodes.forEach(node => {
            if (!node.parentId) root = node;
            else {
                if (!map[node.parentId]) map[node.parentId] = [];
                map[node.parentId].push(node);
            }
        });

        Object.keys(map).forEach(key => {
            map[key].sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
        });

        return { rootNode: root, childrenMap: map, flatList: nodes };
    }, [rawData]);

    // Check if folder can have new subfolder (must have no content children)
    const canCreateSubfolder = useCallback((nodeId: string): boolean => {
        const children = childrenMap[nodeId] || [];
        // Can create subfolder if: no children, or all children are folders
        return children.every(c => c.type === 'folder');
    }, [childrenMap]);

    // Check if folder can accept notes/documents (no folder children)
    const canCreateNote = useCallback((nodeId: string): boolean => {
        const children = childrenMap[nodeId] || [];
        // Can create note if: no children, or no folder children (only documents/fragments)
        return !children.some(c => c.type === 'folder');
    }, [childrenMap]);


    // Filter Logic - search both title and gist
    const filteredNodes = useMemo(() => {
        if (!searchTerm.trim()) return null;
        const term = searchTerm.toLowerCase();
        return flatList.filter(n =>
            n.title.toLowerCase().includes(term) ||
            n.gist.toLowerCase().includes(term) ||
            n.id.toLowerCase().includes(term)
        );
    }, [searchTerm, flatList]);

    // Type badge helper
    const getTypeBadge = (type: string) => {
        switch (type) {
            case 'folder':
                return (
                    <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-100 tracking-wider flex items-center gap-1">
                        <Folder size={10} /> FOLDER
                    </span>
                );
            case 'document':
                return (
                    <span className="text-[10px] font-bold bg-emerald-50 text-emerald-600 px-2 py-1 rounded border border-emerald-100 tracking-wider flex items-center gap-1">
                        <FileText size={10} /> DOCUMENT
                    </span>
                );
            case 'fragment':
                return (
                    <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-1 rounded border border-amber-100 tracking-wider flex items-center gap-1">
                        <Puzzle size={10} /> FRAGMENT
                    </span>
                );
            default:
                return null;
        }
    };

    if (!activeTreeId && !loading && trees.length === 0) return <div className="p-8 text-red-500">No trees found.</div>;
    const activeTreeName = trees.find(t => t.id === activeTreeId)?.name || "Unknown Tree";

    return (
        <div className="flex h-screen bg-zinc-50 text-zinc-900 overflow-hidden select-none">

            {/* SIDEBAR */}
            <div
                className="flex-shrink-0 border-r bg-white flex flex-col h-full shadow-sm z-10 relative"
                style={{ width: sidebarWidth }}
            >
                {/* Header */}
                <div className="p-4 border-b space-y-3 flex-shrink-0 bg-white z-20">
                    {/* KB Selector - Always show with manager button */}
                    <div className="flex items-center gap-1">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="flex-1 justify-between text-xs h-8 px-2 bg-purple-50/50 hover:bg-purple-100/50 border border-purple-100">
                                    <div className="flex items-center gap-2 truncate">
                                        <Library className="w-3 h-3 text-purple-500 shrink-0" />
                                        <span className="truncate font-medium text-purple-700">{activeKbName}</span>
                                    </div>
                                    <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[280px]" align="start">
                                <DropdownMenuLabel className="text-xs text-zinc-400">Knowledge Bases</DropdownMenuLabel>
                                {knowledgeBases.length > 0 ? (
                                    <>
                                        <DropdownMenuItem onClick={() => setActiveKbId(null)}>
                                            <Library className="w-4 h-4 mr-2 text-zinc-400" />
                                            <span className={!activeKbId ? "font-bold" : ""}>Internal Knowledge Base</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        {knowledgeBases.map(kb => (
                                            <DropdownMenuItem key={kb.id} onClick={() => setActiveKbId(kb.id)}>
                                                <Library className="w-4 h-4 mr-2 text-purple-500" />
                                                <div className="flex-1 min-w-0">
                                                    <div className={activeKbId === kb.id ? "font-bold" : "font-medium"}>{kb.name}</div>
                                                    <div className="text-[10px] text-zinc-400 truncate">{kb.organizingPrinciple.slice(0, 50)}...</div>
                                                </div>
                                            </DropdownMenuItem>
                                        ))}
                                    </>
                                ) : (
                                    <div className="px-2 py-3 text-xs text-zinc-400 text-center">
                                        No knowledge bases loaded.<br/>
                                        Click + to create one.
                                    </div>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 border border-purple-100 bg-purple-50/50 hover:bg-purple-100"
                            onClick={() => setKbManagerOpen(true)}
                            title="Manage Knowledge Bases"
                        >
                            <Plus className="w-3 h-3 text-purple-600" />
                        </Button>
                    </div>

                    {/* Tree Selector */}
                    <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="w-full justify-between font-bold text-sm h-10 px-3">
                                        <div className="flex items-center gap-2 truncate">
                                            <Database className="w-4 h-4 text-purple-600 shrink-0" />
                                            <span className="truncate">{activeTreeName}</span>
                                        </div>
                                        <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-[250px]" align="start">
                                    {filteredTrees.map(t => (
                                        <DropdownMenuItem key={t.id} onClick={() => setActiveTreeId(t.id)}>
                                            <span className="font-medium">{t.name}</span>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => loadTreeStructure(activeTreeId)}
                            title="Reload Tree"
                            className="shrink-0"
                        >
                            <RefreshCw className="h-4 w-4"/>
                        </Button>

                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setQueryDialogOpen(true)}
                            title="Query Knowledge Base"
                            className="shrink-0"
                        >
                            <Sparkles className="h-4 w-4 text-purple-600"/>
                        </Button>

                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setChatDialogOpen(true)}
                            title="Chat with Knowledge Base"
                            className="shrink-0"
                        >
                            <MessageSquare className="h-4 w-4 text-emerald-600"/>
                        </Button>

                        <Button
                            variant="default"
                            size="icon"
                            onClick={() => setIngestionOpen(true)}
                            title="Ingest Document"
                            className="shrink-0 bg-purple-600 hover:bg-purple-700"
                        >
                            <Plus className="h-4 w-4"/>
                        </Button>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-zinc-400" />
                        <Input
                            placeholder="Filter nodes..."
                            className="pl-8 h-9 text-sm"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm("")}
                                className="absolute right-2 top-2.5 text-zinc-400 hover:text-zinc-600"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </div>

                {/* TREE CONTENT */}
                <div className="flex-1 min-h-0">
                    <ScrollArea className="h-full">
                        <div className="p-2 pb-10">
                            {loading ? (
                                <div className="flex justify-center p-8"><Loader2 className="animate-spin text-zinc-300" /></div>
                            ) : searchTerm ? (
                                // SEARCH RESULTS VIEW
                                <div className="space-y-1">
                                    <p className="text-xs font-semibold text-zinc-400 px-2 py-1 uppercase tracking-wider">
                                        {filteredNodes?.length} Results
                                    </p>
                                    {filteredNodes?.map(node => (
                                        <div
                                            key={node.id}
                                            onClick={() => setSelectedNode(node)}
                                            className={`px-3 py-2 text-sm rounded cursor-pointer ${selectedNode?.id === node.id ? 'bg-purple-50 text-purple-900 border border-purple-100' : 'hover:bg-zinc-100 text-zinc-700'}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                {node.type === 'folder' && <Folder className="w-4 h-4 text-blue-500 shrink-0" />}
                                                {node.type === 'document' && <FileText className="w-4 h-4 text-emerald-500 shrink-0" />}
                                                {node.type === 'fragment' && <Puzzle className="w-4 h-4 text-amber-500 shrink-0" />}
                                                <div className="truncate min-w-0">
                                                    <div className="font-medium truncate">{node.title}</div>
                                                    <div className="text-[10px] text-zinc-400 truncate">{node.gist}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : rootNode ? (
                                // TREE VIEW
                                <TreeItem
                                    node={rootNode}
                                    childrenMap={childrenMap}
                                    onSelect={setSelectedNode}
                                    selectedId={selectedNode?.id}
                                    onCreateFolder={openCreateFolderDialog}
                                    onCreateContent={openCreateNoteDialog}
                                />
                            ) : (
                                <div className="p-4 text-sm text-zinc-400 text-center">Empty Tree</div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* Resize Handle */}
                <div
                    className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-purple-400/50 active:bg-purple-600 transition-colors z-50"
                    onMouseDown={startResizing}
                />
            </div>

            {/* MAIN CONTENT */}
            <div className="flex-1 flex flex-col h-full min-w-0 bg-white">
                <ScrollArea className="h-full">
                    <div className="p-8 pb-32 max-w-5xl mx-auto">
                        {selectedNode ? (
                            <div className="flex flex-col gap-8 animate-in fade-in duration-300 min-h-[calc(100vh-200px)]">

                                {/* Header */}
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <span className="text-[10px] font-mono bg-zinc-100 text-zinc-500 px-2 py-1 rounded border select-all">
                                                {selectedNode.id}
                                            </span>
                                            {getTypeBadge(selectedNode.type)}
                                            {/* Auto-save status indicator */}
                                            {saveStatus === "saving" && (
                                                <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                                                    <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                                                </span>
                                            )}
                                            {saveStatus === "saved" && (
                                                <span className="text-[10px] text-emerald-500 flex items-center gap-1">
                                                    <Check className="w-3 h-3" /> Saved
                                                </span>
                                            )}
                                            {saveStatus === "error" && (
                                                <span className="text-[10px] text-red-500">Save failed</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {selectedNode.type === 'folder' && canCreateSubfolder(selectedNode.id) && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => openCreateFolderDialog(selectedNode.id)}
                                                    className="gap-1"
                                                >
                                                    <FolderPlus className="w-3 h-3" />
                                                    New Subfolder
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => openMoveDialog(selectedNode.id, selectedNode.type)}
                                                className="gap-1"
                                            >
                                                <Move className="w-3 h-3" />
                                                Move
                                            </Button>
                                            {/* Delete button for content nodes */}
                                            {selectedNode.contentId && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setDeleteDialogOpen(true)}
                                                    className="gap-1 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                    Delete
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    {/* Always editable title */}
                                    <Input
                                        value={editTitle}
                                        onChange={(e) => handleTitleChange(e.target.value)}
                                        className="text-2xl font-bold h-auto py-2 border-transparent hover:border-zinc-200 focus:border-purple-300 bg-transparent"
                                        placeholder="Title..."
                                    />
                                </div>

                                {/* Gist Card (The "Readme") - Always editable */}
                                <div className="bg-zinc-50 rounded-xl border p-6">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                                            Summary
                                        </h3>
                                        {selectedNode.contentId && contentPayload && contentPayload.trim().length > 10 && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleGenerateGist}
                                                disabled={generatingGist}
                                                className="gap-1 text-xs h-7"
                                            >
                                                {generatingGist ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                    <Wand2 className="w-3 h-3" />
                                                )}
                                                Generate Summary
                                            </Button>
                                        )}
                                    </div>
                                    <textarea
                                        value={editGist}
                                        onChange={(e) => handleGistChange(e.target.value)}
                                        className="w-full min-h-[120px] p-3 text-sm border border-transparent hover:border-zinc-200 focus:border-purple-300 rounded-lg resize-y bg-white"
                                        placeholder="Summary/gist..."
                                    />
                                </div>

                                {/* Content Payload (for Documents and Fragments) */}
                                {selectedNode.contentId && (
                                    <div className="flex flex-col flex-1 min-h-0">
                                        <div className="flex items-center justify-between border-b pb-2 mb-4">
                                            <h3 className="font-semibold text-lg flex items-center gap-2">
                                                <FileText className="w-5 h-5 text-emerald-600" /> Content
                                                {/* Edit mode badge */}
                                                {contentEditMode === 'editable' ? (
                                                    <span className="text-[10px] font-bold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded border border-emerald-100 flex items-center gap-1">
                                                        <Unlock className="w-3 h-3" /> EDITABLE
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] font-bold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded border border-zinc-200 flex items-center gap-1">
                                                        <Lock className="w-3 h-3" /> READ-ONLY
                                                    </span>
                                                )}
                                                {/* Content save status */}
                                                {contentSaveStatus === "saving" && (
                                                    <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                                                        <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                                                    </span>
                                                )}
                                                {contentSaveStatus === "saved" && (
                                                    <span className="text-[10px] text-emerald-500 flex items-center gap-1">
                                                        <Check className="w-3 h-3" /> Saved
                                                    </span>
                                                )}
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                {/* Only show Replace Version for documents, not fragments */}
                                                {contentEditMode === 'readonly' && contentPayload && selectedNode.type === 'document' && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => setReplaceVersionOpen(true)}
                                                        className="gap-1"
                                                    >
                                                        <History className="w-3 h-3" />
                                                        Replace Version
                                                    </Button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="rounded-lg border bg-white shadow-sm flex-1 min-h-[300px] relative flex flex-col overflow-hidden">
                                            {contentLoading ? (
                                                <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10 backdrop-blur-sm">
                                                    <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                                                </div>
                                            ) : null}

                                            {contentError ? (
                                                <div className="p-12 text-center">
                                                    <div className="text-red-500 mb-2 font-medium">Failed to load content.</div>
                                                    <Button variant="outline" size="sm" onClick={() => fetchContent(selectedNode.contentId!)}>
                                                        Try Again
                                                    </Button>
                                                </div>
                                            ) : contentEditMode === 'editable' ? (
                                                // Editable content with markdown preview and Edit/Done toggle
                                                <EditableContent
                                                    content={editableContent}
                                                    onChange={handleContentChange}
                                                    placeholder="Start writing..."
                                                />
                                            ) : (
                                                // Read-only content - rendered markdown
                                                <div className="p-6 overflow-auto">
                                                    <MarkdownRenderer content={contentPayload || ""} />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Folder Info (for Folders) */}
                                {selectedNode.type === 'folder' && (
                                    <div className="bg-blue-50/50 rounded-xl border border-blue-100 p-6">
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-400">
                                                Folder Info
                                            </h3>
                                            {/* Create Note button - for folders that can accept documents */}
                                            {canCreateNote(selectedNode.id) && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => openCreateNoteDialog(selectedNode.id)}
                                                    className="gap-1 bg-white"
                                                >
                                                    <FilePlus className="w-3 h-3" />
                                                    Create Note
                                                </Button>
                                            )}
                                        </div>
                                        <p className="text-sm text-blue-700">
                                            This is a folder node. It organizes content but contains no direct payload.
                                            {canCreateSubfolder(selectedNode.id) && canCreateNote(selectedNode.id)
                                                ? " You can create subfolders or notes here."
                                                : canCreateSubfolder(selectedNode.id)
                                                    ? " You can create subfolders here."
                                                    : " You can add documents or notes here."}
                                        </p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="h-[80vh] flex flex-col items-center justify-center text-zinc-300 space-y-4">
                                <div className="w-20 h-20 bg-zinc-50 rounded-full flex items-center justify-center">
                                    <Database className="w-10 h-10 opacity-20" />
                                </div>
                                <p className="text-lg font-medium text-zinc-400">Select a node to inspect details.</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </div>

            {/* Ingestion Dialog */}
            <IngestionDialog
                open={ingestionOpen}
                onOpenChange={setIngestionOpen}
                treeId={activeTreeId}
                treeName={activeTreeName}
                onComplete={() => loadTreeStructure(activeTreeId)}
            />

            {/* Create Folder Dialog */}
            <CreateFolderDialog
                open={createFolderOpen}
                onOpenChange={setCreateFolderOpen}
                treeId={activeTreeId}
                parentId={createFolderParentId}
                onComplete={(newNode) => {
                    // Select the newly created folder after tree reloads
                    loadTreeStructure(activeTreeId, newNode?.id);
                }}
            />

            {/* Move Dialog */}
            <MoveDialog
                open={moveDialogOpen}
                onOpenChange={setMoveDialogOpen}
                treeId={activeTreeId}
                nodeId={moveNodeId}
                nodeType={moveNodeType}
                flatList={flatList}
                childrenMap={childrenMap}
                onComplete={() => loadTreeStructure(activeTreeId)}
            />

            {/* Query Dialog */}
            <QueryDialog
                open={queryDialogOpen}
                onOpenChange={setQueryDialogOpen}
                treeId={activeTreeId}
                treeName={activeTreeName}
            />

            {/* Chat Dialog */}
            <ChatDialog
                open={chatDialogOpen}
                onOpenChange={setChatDialogOpen}
                kbId={activeKbId || 'internal'}
                kbName={activeKbName}
                trees={trees}
                defaultTreeId={activeTreeId}
            />

            {/* KB Manager Dialog */}
            <KBManagerDialog
                open={kbManagerOpen}
                onOpenChange={setKbManagerOpen}
                knowledgeBases={knowledgeBases}
                trees={trees}
                onKBCreated={(newKbId) => {
                    reloadKnowledgeBases();
                    reloadTrees();
                    // Switch to the newly created KB
                    if (newKbId) {
                        setActiveKbId(newKbId);
                    }
                }}
                onTreeCreated={reloadTrees}
            />

            {/* Create Note Dialog */}
            <CreateNoteDialog
                open={createNoteOpen}
                onOpenChange={setCreateNoteOpen}
                treeId={activeTreeId}
                parentId={createNoteParentId}
                onComplete={(newNode) => {
                    // Pass the new node ID to select it after tree reloads
                    loadTreeStructure(activeTreeId, newNode?.id);
                }}
            />

            {/* Delete Confirmation Dialog */}
            <DeleteNodeDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                nodeId={selectedNode?.id || ""}
                nodeTitle={selectedNode?.title || ""}
                nodeType={selectedNode?.type || ""}
                onComplete={() => {
                    setSelectedNode(null);
                    loadTreeStructure(activeTreeId);
                }}
            />

            {/* Replace Version Dialog */}
            <ReplaceVersionDialog
                open={replaceVersionOpen}
                onOpenChange={setReplaceVersionOpen}
                nodeId={selectedNode?.id || ""}
                currentContent={contentPayload || ""}
                onComplete={(newContent, newContentId) => {
                    setContentPayload(newContent);
                    if (newContentId && selectedNode) {
                        setSelectedNode({ ...selectedNode, contentId: newContentId });
                    }
                }}
            />
        </div>
    );
}
