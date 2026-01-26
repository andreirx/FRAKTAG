import { useState, useEffect } from "react";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Library, Plus, FolderOpen, TreeDeciduous, Check, AlertCircle, RefreshCw, Database, CheckCircle, PackageOpen, ArrowRight, X, Sparkles, Folder } from "lucide-react";

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

interface TreeInfo {
    id: string;
    name: string;
    organizingPrinciple: string;
    nodeCount?: number;
}

interface KBManagerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    knowledgeBases: KnowledgeBase[];
    trees: TreeInfo[];
    onKBCreated: (newKbId?: string) => void;  // Pass the new KB ID so caller can switch to it
    onTreeCreated: () => void;
}

type Tab = "browse" | "create" | "export" | "add-tree";

export function KBManagerDialog({
    open,
    onOpenChange,
    knowledgeBases,
    trees,
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
    const [seedFolderNames, setSeedFolderNames] = useState<string[]>([]);
    const [seedFolderInput, setSeedFolderInput] = useState("");

    // KB Presets
    const kbPresets = [
        {
            id: "personal-notes",
            name: "Personal Notes",
            principle: "Personal thoughts, ideas, and reflections. Organized by topic and life area.",
            folders: ["Daily Journal", "Ideas & Brainstorms", "Learning", "Goals & Plans"],
        },
        {
            id: "project-docs",
            name: "Project Documentation",
            principle: "Technical documentation for software projects. Organized by project, then by documentation type (architecture, API, guides).",
            folders: ["Architecture", "API Reference", "User Guides", "Development Notes"],
        },
        {
            id: "research",
            name: "Research Collection",
            principle: "Research papers, articles, and study notes. Organized by field and topic.",
            folders: ["Papers", "Books", "Articles", "My Notes"],
        },
        {
            id: "team-wiki",
            name: "Team Wiki",
            principle: "Shared team knowledge base. Organized by department, process, and project.",
            folders: ["Onboarding", "Processes", "Best Practices", "Meeting Notes"],
        },
        {
            id: "custom",
            name: "Custom (blank)",
            principle: "",
            folders: [],
        },
    ];

    // Export KB state
    const [selectedTreeIds, setSelectedTreeIds] = useState<string[]>([]);
    const [exportKbName, setExportKbName] = useState("");
    const [exportKbPrinciple, setExportKbPrinciple] = useState("");
    const [exporting, setExporting] = useState(false);
    const [exportResult, setExportResult] = useState<{ trees: number; nodes: number; content: number } | null>(null);

    // Add Tree state
    const [selectedKbId, setSelectedKbId] = useState("");
    const [newTreeName, setNewTreeName] = useState("");

    // Auto-generate tree ID from name
    const generateTreeId = (name: string): string => {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            || 'tree';
    };

    const newTreeId = generateTreeId(newTreeName);

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
        setSeedFolderNames([]);
        setSeedFolderInput("");
        setSelectedKbId("");
        setNewTreeName("");
        setSelectedTreeIds([]);
        setExportKbName("");
        setExportKbPrinciple("");
        setExportResult(null);
        setError(null);
        setSuccess(null);
    };

    const handlePresetSelect = (presetId: string) => {
        const preset = kbPresets.find(p => p.id === presetId);
        if (!preset) return;

        // Always update principle
        setNewKbPrinciple(preset.principle);

        // Only populate folders if user hasn't entered any
        if (seedFolderNames.length === 0 && !seedFolderInput.trim()) {
            setSeedFolderNames(preset.folders);
        }
    };

    const addSeedFolder = () => {
        const name = seedFolderInput.trim();
        if (name && !seedFolderNames.includes(name)) {
            setSeedFolderNames(prev => [...prev, name]);
            setSeedFolderInput("");
        }
    };

    const removeSeedFolder = (name: string) => {
        setSeedFolderNames(prev => prev.filter(n => n !== name));
    };

    const toggleTreeSelection = (treeId: string) => {
        setSelectedTreeIds(prev =>
            prev.includes(treeId)
                ? prev.filter(id => id !== treeId)
                : [...prev, treeId]
        );
    };

    const handleExportTrees = async () => {
        if (selectedTreeIds.length === 0) {
            setError("Select at least one tree to export");
            return;
        }
        if (!exportKbName.trim() || !exportKbPrinciple.trim()) {
            setError("Name and organizing principle are required");
            return;
        }

        setExporting(true);
        setError(null);
        setSuccess(null);
        setExportResult(null);

        try {
            const res = await axios.post("/api/knowledge-bases/export", {
                treeIds: selectedTreeIds,
                name: exportKbName,
                organizingPrinciple: exportKbPrinciple,
            });
            setSuccess(`Exported to new KB "${res.data.kb.name}"`);
            setExportResult(res.data.stats);
            onKBCreated();
            await discoverKBs();
        } catch (e: any) {
            setError(e.response?.data?.error || e.message);
        } finally {
            setExporting(false);
        }
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

        // Build seed folders array with simple gists
        const seedFolders = seedFolderNames.map(name => ({
            title: name,
            gist: `${name} content`,
        }));

        try {
            const res = await axios.post("/api/knowledge-bases", {
                name: newKbName,
                organizingPrinciple: newKbPrinciple,
                seedFolders: seedFolders.length > 0 ? seedFolders : undefined,
            });
            setSuccess(`Created knowledge base "${newKbName}"`);
            // Pass the new KB ID so caller can switch to it
            onKBCreated(res.data.id);
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
        if (!newTreeName.trim()) {
            setError("Tree name is required");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            // For internal KB, use a different endpoint
            if (selectedKbId === "_internal" || !selectedKbId) {
                await axios.post(`/api/trees`, {
                    treeId: newTreeId,
                    treeName: newTreeName,
                });
            } else {
                await axios.post(`/api/knowledge-bases/${selectedKbId}/trees`, {
                    treeId: newTreeId,
                    treeName: newTreeName,
                });
            }
            onTreeCreated();
            resetForm();
            onOpenChange(false); // Close dialog
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
                <div className="flex gap-1 border-b pb-2 mt-2 flex-wrap">
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
                        variant={activeTab === "export" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => { setActiveTab("export"); setError(null); setSuccess(null); setExportResult(null); }}
                        className="gap-1"
                        disabled={trees.length === 0}
                    >
                        <PackageOpen className="w-3 h-3" /> Export Trees
                    </Button>
                    <Button
                        variant={activeTab === "add-tree" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => { setActiveTab("add-tree"); setError(null); setSuccess(null); }}
                        className="gap-1"
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
                        <ScrollArea className="flex-1">
                            <div className="space-y-4 pr-4">
                                {/* Presets */}
                                <div>
                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                                        <Sparkles className="w-3 h-3" /> Start with a Template
                                    </label>
                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                        {kbPresets.map((preset) => (
                                            <button
                                                key={preset.id}
                                                onClick={() => handlePresetSelect(preset.id)}
                                                className={`text-left p-3 rounded-lg border transition-colors ${
                                                    newKbPrinciple === preset.principle && preset.principle
                                                        ? "border-purple-300 bg-purple-50"
                                                        : "border-zinc-200 hover:border-purple-200 hover:bg-purple-50/50"
                                                }`}
                                            >
                                                <div className="font-medium text-sm">{preset.name}</div>
                                                {preset.folders.length > 0 && (
                                                    <div className="text-[10px] text-zinc-500 mt-1">
                                                        {preset.folders.slice(0, 3).join(", ")}
                                                        {preset.folders.length > 3 && "..."}
                                                    </div>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Name */}
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

                                {/* Organizing Principle */}
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
                                    <p className="text-[10px] text-zinc-400 mt-1">
                                        This guides how documents are categorized and structured
                                    </p>
                                </div>

                                {/* Seed Folders */}
                                <div>
                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                                        <Folder className="w-3 h-3" /> Top-Level Folders (optional)
                                    </label>
                                    <div className="flex gap-2 mt-1">
                                        <Input
                                            value={seedFolderInput}
                                            onChange={(e) => setSeedFolderInput(e.target.value)}
                                            placeholder="Add a folder..."
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    addSeedFolder();
                                                }
                                            }}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={addSeedFolder}
                                            disabled={!seedFolderInput.trim()}
                                        >
                                            <Plus className="w-4 h-4" />
                                        </Button>
                                    </div>
                                    {seedFolderNames.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            {seedFolderNames.map((name) => (
                                                <span
                                                    key={name}
                                                    className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-100 text-zinc-700 rounded text-sm"
                                                >
                                                    <Folder className="w-3 h-3 text-zinc-500" />
                                                    {name}
                                                    <button
                                                        onClick={() => removeSeedFolder(name)}
                                                        className="ml-1 text-zinc-400 hover:text-red-500"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    <p className="text-[10px] text-zinc-400 mt-1">
                                        These folders will be created automatically when the KB is created
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
                        </ScrollArea>
                    )}

                    {activeTab === "export" && (
                        <div className="space-y-4">
                            {/* Tree Selection */}
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Select Trees to Export
                                </label>
                                <div className="mt-2 space-y-2 max-h-40 overflow-y-auto border rounded-lg p-2">
                                    {trees.map((tree) => (
                                        <label
                                            key={tree.id}
                                            className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                                                selectedTreeIds.includes(tree.id)
                                                    ? "bg-purple-50 border border-purple-200"
                                                    : "hover:bg-zinc-50 border border-transparent"
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedTreeIds.includes(tree.id)}
                                                onChange={() => toggleTreeSelection(tree.id)}
                                                className="w-4 h-4 text-purple-600 rounded"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <TreeDeciduous className="w-4 h-4 text-emerald-600" />
                                                    <span className="font-medium text-sm">{tree.name}</span>
                                                </div>
                                                <div className="text-xs text-zinc-500 truncate">{tree.id}</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                                <p className="text-[10px] text-zinc-400 mt-1">
                                    {selectedTreeIds.length} tree(s) selected
                                </p>
                            </div>

                            {/* Arrow indicator */}
                            {selectedTreeIds.length > 0 && (
                                <div className="flex items-center justify-center text-zinc-300">
                                    <ArrowRight className="w-6 h-6" />
                                </div>
                            )}

                            {/* New KB Details */}
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    New Knowledge Base Name
                                </label>
                                <Input
                                    value={exportKbName}
                                    onChange={(e) => setExportKbName(e.target.value)}
                                    placeholder="My Portable Knowledge Base"
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Organizing Principle
                                </label>
                                <textarea
                                    value={exportKbPrinciple}
                                    onChange={(e) => setExportKbPrinciple(e.target.value)}
                                    placeholder="Describe the purpose and organization of this knowledge base..."
                                    className="w-full mt-1 min-h-[80px] p-3 text-sm border rounded-lg resize-y"
                                />
                            </div>

                            {/* Export Result */}
                            {exportResult && (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
                                    <div className="font-medium text-emerald-700 mb-1">Export Complete!</div>
                                    <div className="text-emerald-600 text-xs space-y-1">
                                        <div>{exportResult.trees} tree(s) exported</div>
                                        <div>{exportResult.nodes} node(s) copied</div>
                                        <div>{exportResult.content} content atom(s) copied</div>
                                    </div>
                                </div>
                            )}

                            <Button
                                onClick={handleExportTrees}
                                disabled={exporting || selectedTreeIds.length === 0 || !exportKbName.trim() || !exportKbPrinciple.trim()}
                                className="w-full bg-purple-600 hover:bg-purple-700"
                            >
                                {exporting ? (
                                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                ) : (
                                    <PackageOpen className="w-4 h-4 mr-2" />
                                )}
                                Export to New Knowledge Base
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
                                    <option value="_internal">Internal Knowledge Base</option>
                                    {knowledgeBases.map((kb) => (
                                        <option key={kb.id} value={kb.id}>
                                            {kb.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    Tree Name
                                </label>
                                <Input
                                    value={newTreeName}
                                    onChange={(e) => setNewTreeName(e.target.value)}
                                    placeholder="My New Tree"
                                    className="mt-1"
                                />
                                {newTreeName.trim() && (
                                    <p className="text-[10px] text-zinc-400 mt-1">
                                        ID: <span className="font-mono bg-zinc-100 px-1 rounded">{newTreeId}</span>
                                    </p>
                                )}
                            </div>
                            <Button
                                onClick={handleAddTree}
                                disabled={loading || !newTreeName.trim()}
                                className="w-full bg-emerald-600 hover:bg-emerald-700"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <TreeDeciduous className="w-4 h-4 mr-2" />}
                                Create Tree
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
