import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import axios from 'axios';
import { TreeItem, TreeNode } from "@/components/fraktag/TreeItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, RefreshCw, Database, FileText, Folder, Puzzle, ChevronDown, X, Plus, Pencil, Check, XCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IngestionDialog } from "@/components/fraktag/IngestionDialog";

export default function KnowledgeTree() {
    const [loading, setLoading] = useState(true);
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

    // Edit Mode State
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState("");
    const [editGist, setEditGist] = useState("");
    const [saving, setSaving] = useState(false);

    // Sidebar Resize State
    const [sidebarWidth, setSidebarWidth] = useState(400);
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

    // Initial Load
    useEffect(() => {
        async function fetchTrees() {
            try {
                const res = await axios.get('/api/trees');
                setTrees(res.data);
                if (res.data.length > 0) setActiveTreeId(res.data[0].id);
            } catch (e) {
                console.error("Failed to list trees", e);
            }
        }
        fetchTrees();
    }, []);

    useEffect(() => {
        if (activeTreeId) loadTreeStructure(activeTreeId);
    }, [activeTreeId]);

    // Content Fetching & Reset Edit Mode
    useEffect(() => {
        setContentPayload(null);
        setContentError(false);
        setContentLoading(false);
        setIsEditing(false);
        if (selectedNode?.contentId) {
            fetchContent(selectedNode.contentId);
        }
    }, [selectedNode]);

    // Enter edit mode
    const startEditing = () => {
        if (!selectedNode) return;
        setEditTitle(selectedNode.title);
        setEditGist(selectedNode.gist);
        setIsEditing(true);
    };

    // Cancel editing
    const cancelEditing = () => {
        setIsEditing(false);
        setEditTitle("");
        setEditGist("");
    };

    // Save changes
    const saveChanges = async () => {
        if (!selectedNode) return;
        setSaving(true);
        try {
            const res = await axios.patch(`/api/nodes/${selectedNode.id}`, {
                title: editTitle,
                gist: editGist,
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
            setIsEditing(false);
        } catch (e) {
            console.error("Failed to save:", e);
        } finally {
            setSaving(false);
        }
    };

    async function loadTreeStructure(id: string) {
        setLoading(true);
        try {
            const res = await axios.get(`/api/trees/${id}/structure`);
            setRawData(res.data);
            setSelectedNode(null);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }

    async function fetchContent(id: string) {
        setContentLoading(true);
        try {
            const res = await axios.get(`/api/content/${encodeURIComponent(id)}`);
            setContentPayload(res.data.payload);
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
                <div className="p-4 border-b space-y-4 flex-shrink-0 bg-white z-20">
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
                                    {trees.map(t => (
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
                            <div className="space-y-8 animate-in fade-in duration-300">

                                {/* Header */}
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <span className="text-[10px] font-mono bg-zinc-100 text-zinc-500 px-2 py-1 rounded border select-all">
                                                {selectedNode.id}
                                            </span>
                                            {getTypeBadge(selectedNode.type)}
                                        </div>
                                        {!isEditing ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={startEditing}
                                                className="gap-1"
                                            >
                                                <Pencil className="w-3 h-3" />
                                                Edit
                                            </Button>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={cancelEditing}
                                                    disabled={saving}
                                                >
                                                    <XCircle className="w-4 h-4" />
                                                    Cancel
                                                </Button>
                                                <Button
                                                    variant="default"
                                                    size="sm"
                                                    onClick={saveChanges}
                                                    disabled={saving}
                                                    className="bg-emerald-600 hover:bg-emerald-700"
                                                >
                                                    {saving ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <Check className="w-4 h-4" />
                                                    )}
                                                    Save
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                    {isEditing ? (
                                        <Input
                                            value={editTitle}
                                            onChange={(e) => setEditTitle(e.target.value)}
                                            className="text-2xl font-bold h-auto py-2"
                                            placeholder="Title..."
                                        />
                                    ) : (
                                        <h1 className="text-3xl font-bold leading-tight text-zinc-900">
                                            {selectedNode.title}
                                        </h1>
                                    )}
                                </div>

                                {/* Gist Card (The "Readme") */}
                                <div className="bg-zinc-50 rounded-xl border p-6">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
                                        Summary
                                    </h3>
                                    {isEditing ? (
                                        <textarea
                                            value={editGist}
                                            onChange={(e) => setEditGist(e.target.value)}
                                            className="w-full min-h-[120px] p-3 text-sm border rounded-lg resize-y bg-white"
                                            placeholder="Summary/gist..."
                                        />
                                    ) : (
                                        <div className="prose prose-sm max-w-none text-zinc-700 whitespace-pre-wrap">
                                            {selectedNode.gist}
                                        </div>
                                    )}
                                </div>

                                {/* Content Payload (for Documents and Fragments) */}
                                {selectedNode.contentId && (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between border-b pb-2">
                                            <h3 className="font-semibold text-lg flex items-center gap-2">
                                                <FileText className="w-5 h-5 text-emerald-600" /> Source Content
                                            </h3>
                                        </div>

                                        <div className="rounded-lg border bg-white shadow-sm min-h-[100px] relative">
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
                                            ) : (
                                                <div className="p-6 overflow-x-auto">
                                                    <pre className="text-xs font-mono text-zinc-600 whitespace-pre-wrap leading-relaxed select-text">
                                                        {contentPayload || "Loading content..."}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Folder Info (for Folders) */}
                                {selectedNode.type === 'folder' && (
                                    <div className="bg-blue-50/50 rounded-xl border border-blue-100 p-6">
                                        <h3 className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-3">
                                            Folder Info
                                        </h3>
                                        <p className="text-sm text-blue-700">
                                            This is a folder node. It organizes content but contains no direct payload.
                                            Select a child document or fragment to view content.
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
        </div>
    );
}
