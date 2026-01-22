import { useState } from "react";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Library, Plus, FolderOpen, TreeDeciduous, Check, AlertCircle } from "lucide-react";

interface KnowledgeBase {
    id: string;
    name: string;
    path: string;
    organizingPrinciple: string;
    defaultTreeId: string;
    trees?: string[];
}

interface KBManagerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    knowledgeBases: KnowledgeBase[];
    onKBCreated: () => void;
    onTreeCreated: () => void;
}

type Tab = "create" | "load" | "add-tree";

export function KBManagerDialog({
    open,
    onOpenChange,
    knowledgeBases,
    onKBCreated,
    onTreeCreated,
}: KBManagerDialogProps) {
    const [activeTab, setActiveTab] = useState<Tab>("create");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Create KB state
    const [newKbPath, setNewKbPath] = useState("");
    const [newKbName, setNewKbName] = useState("");
    const [newKbPrinciple, setNewKbPrinciple] = useState("");

    // Load KB state
    const [loadKbPath, setLoadKbPath] = useState("");

    // Add Tree state
    const [selectedKbId, setSelectedKbId] = useState("");
    const [newTreeId, setNewTreeId] = useState("");
    const [newTreeName, setNewTreeName] = useState("");

    const resetForm = () => {
        setNewKbPath("");
        setNewKbName("");
        setNewKbPrinciple("");
        setLoadKbPath("");
        setSelectedKbId("");
        setNewTreeId("");
        setNewTreeName("");
        setError(null);
        setSuccess(null);
    };

    const handleCreateKB = async () => {
        if (!newKbPath.trim() || !newKbName.trim() || !newKbPrinciple.trim()) {
            setError("All fields are required");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await axios.post("/api/knowledge-bases", {
                path: newKbPath,
                name: newKbName,
                organizingPrinciple: newKbPrinciple,
            });
            setSuccess(`Created knowledge base "${newKbName}"`);
            onKBCreated();
            resetForm();
        } catch (e: any) {
            setError(e.response?.data?.error || e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLoadKB = async () => {
        if (!loadKbPath.trim()) {
            setError("Path is required");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await axios.post("/api/knowledge-bases/load", {
                path: loadKbPath,
            });
            setSuccess(`Loaded knowledge base from "${loadKbPath}"`);
            onKBCreated();
            resetForm();
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Library className="w-5 h-5 text-purple-600" />
                        Knowledge Base Manager
                    </DialogTitle>
                    <DialogDescription>
                        Create, load, and manage portable knowledge bases
                    </DialogDescription>
                </DialogHeader>

                {/* Tabs */}
                <div className="flex gap-1 border-b pb-2 mt-2">
                    <Button
                        variant={activeTab === "create" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => { setActiveTab("create"); setError(null); setSuccess(null); }}
                        className="gap-1"
                    >
                        <Plus className="w-3 h-3" /> Create KB
                    </Button>
                    <Button
                        variant={activeTab === "load" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => { setActiveTab("load"); setError(null); setSuccess(null); }}
                        className="gap-1"
                    >
                        <FolderOpen className="w-3 h-3" /> Load KB
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
                <div className="space-y-4 pt-2">
                    {activeTab === "create" && (
                        <>
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Folder Path
                                </label>
                                <Input
                                    value={newKbPath}
                                    onChange={(e) => setNewKbPath(e.target.value)}
                                    placeholder="./knowledge-bases/my-kb"
                                    className="mt-1"
                                />
                                <p className="text-[10px] text-zinc-400 mt-1">
                                    Relative to the engine data folder, or absolute path
                                </p>
                            </div>
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
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Organizing Principle
                                </label>
                                <textarea
                                    value={newKbPrinciple}
                                    onChange={(e) => setNewKbPrinciple(e.target.value)}
                                    placeholder="Describe how content should be organized in this knowledge base..."
                                    className="w-full mt-1 min-h-[80px] p-3 text-sm border rounded-lg resize-y"
                                />
                            </div>
                            <Button
                                onClick={handleCreateKB}
                                disabled={loading || !newKbPath.trim() || !newKbName.trim() || !newKbPrinciple.trim()}
                                className="w-full bg-purple-600 hover:bg-purple-700"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                                Create Knowledge Base
                            </Button>
                        </>
                    )}

                    {activeTab === "load" && (
                        <>
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Knowledge Base Path
                                </label>
                                <Input
                                    value={loadKbPath}
                                    onChange={(e) => setLoadKbPath(e.target.value)}
                                    placeholder="./path/to/existing-kb"
                                    className="mt-1"
                                />
                                <p className="text-[10px] text-zinc-400 mt-1">
                                    Path to a folder containing kb.json
                                </p>
                            </div>
                            <Button
                                onClick={handleLoadKB}
                                disabled={loading || !loadKbPath.trim()}
                                className="w-full"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FolderOpen className="w-4 h-4 mr-2" />}
                                Load Knowledge Base
                            </Button>
                        </>
                    )}

                    {activeTab === "add-tree" && (
                        <>
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
                        </>
                    )}
                </div>

                {/* Existing KBs info */}
                {knowledgeBases.length > 0 && (
                    <div className="border-t pt-4 mt-4">
                        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                            Loaded Knowledge Bases ({knowledgeBases.length})
                        </h4>
                        <div className="space-y-2 max-h-32 overflow-y-auto">
                            {knowledgeBases.map((kb) => (
                                <div key={kb.id} className="text-xs bg-zinc-50 rounded p-2">
                                    <div className="font-medium">{kb.name}</div>
                                    <div className="text-zinc-400 truncate">{kb.path}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
