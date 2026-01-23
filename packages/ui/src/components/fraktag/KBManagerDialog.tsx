import { useState, useEffect } from "react";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Library, Plus, FolderOpen, TreeDeciduous, Check, AlertCircle, RefreshCw, Database, CheckCircle } from "lucide-react";

interface KnowledgeBase {
    id: string;
    name: string;
    path: string;
    organizingPrinciple: string;
    defaultTreeId: string;
    trees?: string[];
}

interface DiscoveredKB {
    id: string;
    name: string;
    path: string;
    folderName: string;
    organizingPrinciple: string;
    isLoaded: boolean;
}

interface KBManagerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    knowledgeBases: KnowledgeBase[];
    onKBCreated: () => void;
    onTreeCreated: () => void;
}

type Tab = "browse" | "create" | "add-tree";

export function KBManagerDialog({
    open,
    onOpenChange,
    knowledgeBases,
    onKBCreated,
    onTreeCreated,
}: KBManagerDialogProps) {
    const [activeTab, setActiveTab] = useState<Tab>("browse");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Discovery state
    const [discovering, setDiscovering] = useState(false);
    const [discoveredKBs, setDiscoveredKBs] = useState<DiscoveredKB[]>([]);
    const [storagePath, setStoragePath] = useState<string | null>(null);
    const [loadingKbId, setLoadingKbId] = useState<string | null>(null);

    // Create KB state
    const [newKbName, setNewKbName] = useState("");
    const [newKbPrinciple, setNewKbPrinciple] = useState("");

    // Add Tree state
    const [selectedKbId, setSelectedKbId] = useState("");
    const [newTreeId, setNewTreeId] = useState("");
    const [newTreeName, setNewTreeName] = useState("");

    // Discover KBs when dialog opens
    useEffect(() => {
        if (open) {
            discoverKBs();
        }
    }, [open]);

    const discoverKBs = async () => {
        setDiscovering(true);
        setError(null);
        try {
            const res = await axios.get("/api/knowledge-bases/discover");
            setDiscoveredKBs(res.data.knowledgeBases);
            setStoragePath(res.data.storagePath);
        } catch (e: any) {
            setError(e.response?.data?.error || e.message);
        } finally {
            setDiscovering(false);
        }
    };

    const resetForm = () => {
        setNewKbName("");
        setNewKbPrinciple("");
        setSelectedKbId("");
        setNewTreeId("");
        setNewTreeName("");
        setError(null);
        setSuccess(null);
    };

    const handleLoadKB = async (kb: DiscoveredKB) => {
        setLoadingKbId(kb.id);
        setError(null);
        setSuccess(null);

        try {
            await axios.post("/api/knowledge-bases/load", {
                path: kb.path,
            });
            setSuccess(`Loaded knowledge base "${kb.name}"`);
            onKBCreated();
            await discoverKBs(); // Refresh the list
        } catch (e: any) {
            setError(e.response?.data?.error || e.message);
        } finally {
            setLoadingKbId(null);
        }
    };

    const handleCreateKB = async () => {
        if (!newKbName.trim() || !newKbPrinciple.trim()) {
            setError("Name and organizing principle are required");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await axios.post("/api/knowledge-bases", {
                name: newKbName,
                organizingPrinciple: newKbPrinciple,
            });
            setSuccess(`Created knowledge base "${newKbName}"`);
            onKBCreated();
            resetForm();
            await discoverKBs(); // Refresh the list
            setActiveTab("browse"); // Go back to browse
        } catch (e: any) {
            setError(e.response?.data?.error || e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAddTree = async () => {
        if (!selectedKbId || !newTreeId.trim()) {
            setError("KB and Tree ID are required");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await axios.post(`/api/knowledge-bases/${selectedKbId}/trees`, {
                treeId: newTreeId,
                treeName: newTreeName || newTreeId,
            });
            setSuccess(`Added tree "${newTreeId}" to knowledge base`);
            onTreeCreated();
            resetForm();
        } catch (e: any) {
            setError(e.response?.data?.error || e.message);
        } finally {
            setLoading(false);
        }
    };

    const loadedCount = discoveredKBs.filter(kb => kb.isLoaded).length;
    const unloadedCount = discoveredKBs.filter(kb => !kb.isLoaded).length;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Library className="w-5 h-5 text-purple-600" />
                        Knowledge Base Manager
                    </DialogTitle>
                    <DialogDescription>
                        Browse, load, and create knowledge bases
                    </DialogDescription>
                </DialogHeader>

                {/* Tabs */}
                <div className="flex gap-1 border-b pb-2 mt-2">
                    <Button
                        variant={activeTab === "browse" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => { setActiveTab("browse"); setError(null); setSuccess(null); }}
                        className="gap-1"
                    >
                        <Database className="w-3 h-3" /> Browse
                    </Button>
                    <Button
                        variant={activeTab === "create" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => { setActiveTab("create"); setError(null); setSuccess(null); }}
                        className="gap-1"
                    >
                        <Plus className="w-3 h-3" /> Create New
                    </Button>
                    <Button
                        variant={activeTab === "add-tree" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => { setActiveTab("add-tree"); setError(null); setSuccess(null); }}
                        className="gap-1"
                        disabled={knowledgeBases.length === 0}
                    >
                        <TreeDeciduous className="w-3 h-3" /> Add Tree
                    </Button>
                </div>

                {/* Error / Success Messages */}
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {error}
                    </div>
                )}
                {success && (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded text-sm flex items-center gap-2">
                        <Check className="w-4 h-4 shrink-0" />
                        {success}
                    </div>
                )}

                {/* Tab Content */}
                <div className="flex-1 overflow-hidden flex flex-col pt-2">
                    {activeTab === "browse" && (
                        <div className="flex-1 overflow-hidden flex flex-col space-y-4">
                            {/* Storage Path Info */}
                            {storagePath && (
                                <div className="text-xs text-zinc-500 bg-zinc-50 px-3 py-2 rounded border flex items-center justify-between">
                                    <span>
                                        <span className="font-medium">Storage:</span> {storagePath}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={discoverKBs}
                                        disabled={discovering}
                                        className="h-6 px-2"
                                    >
                                        <RefreshCw className={`w-3 h-3 ${discovering ? 'animate-spin' : ''}`} />
                                    </Button>
                                </div>
                            )}

                            {/* KB List */}
                            <ScrollArea className="flex-1">
                                {discovering ? (
                                    <div className="flex items-center justify-center py-12">
                                        <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                                    </div>
                                ) : discoveredKBs.length === 0 ? (
                                    <div className="text-center py-12 text-zinc-400">
                                        <Database className="w-12 h-12 mx-auto mb-4 opacity-30" />
                                        <p className="font-medium">No knowledge bases found</p>
                                        <p className="text-sm mt-1">Create a new one to get started</p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setActiveTab("create")}
                                            className="mt-4"
                                        >
                                            <Plus className="w-4 h-4 mr-1" />
                                            Create Knowledge Base
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="space-y-2 pr-4">
                                        {/* Summary */}
                                        <div className="text-xs text-zinc-500 mb-3">
                                            {loadedCount} loaded, {unloadedCount} available
                                        </div>

                                        {discoveredKBs.map((kb) => (
                                            <div
                                                key={kb.id}
                                                className={`border rounded-lg p-4 transition-colors ${
                                                    kb.isLoaded
                                                        ? "bg-emerald-50 border-emerald-200"
                                                        : "bg-white border-zinc-200 hover:border-purple-200"
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold text-zinc-900">{kb.name}</span>
                                                            {kb.isLoaded && (
                                                                <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                                                                    <CheckCircle className="w-3 h-3" />
                                                                    Loaded
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-zinc-500 mt-1 truncate" title={kb.path}>
                                                            {kb.folderName}
                                                        </div>
                                                        <div className="text-sm text-zinc-600 mt-2 line-clamp-2">
                                                            {kb.organizingPrinciple}
                                                        </div>
                                                    </div>
                                                    {!kb.isLoaded && (
                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleLoadKB(kb)}
                                                            disabled={loadingKbId === kb.id}
                                                            className="shrink-0"
                                                        >
                                                            {loadingKbId === kb.id ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <FolderOpen className="w-4 h-4" />
                                                            )}
                                                            Load
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    )}

                    {activeTab === "create" && (
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Name
                                </label>
                                <Input
                                    value={newKbName}
                                    onChange={(e) => setNewKbName(e.target.value)}
                                    placeholder="My Knowledge Base"
                                    className="mt-1"
                                />
                                <p className="text-[10px] text-zinc-400 mt-1">
                                    A folder will be automatically created in the storage path
                                </p>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Organizing Principle
                                </label>
                                <textarea
                                    value={newKbPrinciple}
                                    onChange={(e) => setNewKbPrinciple(e.target.value)}
                                    placeholder="Describe how content should be organized in this knowledge base..."
                                    className="w-full mt-1 min-h-[100px] p-3 text-sm border rounded-lg resize-y"
                                />
                                <p className="text-[10px] text-zinc-400 mt-1">
                                    This guides how documents are categorized and structured
                                </p>
                            </div>
                            <Button
                                onClick={handleCreateKB}
                                disabled={loading || !newKbName.trim() || !newKbPrinciple.trim()}
                                className="w-full bg-purple-600 hover:bg-purple-700"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                                Create Knowledge Base
                            </Button>
                        </div>
                    )}

                    {activeTab === "add-tree" && (
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Knowledge Base
                                </label>
                                <select
                                    value={selectedKbId}
                                    onChange={(e) => setSelectedKbId(e.target.value)}
                                    className="w-full mt-1 h-10 px-3 text-sm border rounded-lg bg-white"
                                >
                                    <option value="">Select a knowledge base...</option>
                                    {knowledgeBases.map((kb) => (
                                        <option key={kb.id} value={kb.id}>
                                            {kb.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Tree ID
                                </label>
                                <Input
                                    value={newTreeId}
                                    onChange={(e) => setNewTreeId(e.target.value)}
                                    placeholder="my-tree"
                                    className="mt-1"
                                />
                                <p className="text-[10px] text-zinc-400 mt-1">
                                    Unique identifier (lowercase, no spaces)
                                </p>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Tree Name (optional)
                                </label>
                                <Input
                                    value={newTreeName}
                                    onChange={(e) => setNewTreeName(e.target.value)}
                                    placeholder="My Tree"
                                    className="mt-1"
                                />
                            </div>
                            <Button
                                onClick={handleAddTree}
                                disabled={loading || !selectedKbId || !newTreeId.trim()}
                                className="w-full bg-emerald-600 hover:bg-emerald-700"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <TreeDeciduous className="w-4 h-4 mr-2" />}
                                Add Tree to KB
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
