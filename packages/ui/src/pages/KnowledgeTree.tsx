import { useEffect, useState, useMemo } from "react";
import axios from 'axios';
import { TreeItem, TreeNode } from "@/components/fraktag/TreeItem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, RefreshCw, Database, FileText, ChevronDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function KnowledgeTree() {
    const [loading, setLoading] = useState(true);
    const [trees, setTrees] = useState<any[]>([]); 
    const [activeTreeId, setActiveTreeId] = useState<string>(""); 
    const [rawData, setRawData] = useState<any>(null);
    const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
    const [searchTerm, setSearchTerm] = useState("");

    // NEW: Content Viewer State
    const [contentPayload, setContentPayload] = useState<string | null>(null);
    const [contentLoading, setContentLoading] = useState(false);

    // 1. Initial Load: Get List of Trees
    useEffect(() => {
        async function fetchTrees() {
            try {
                const res = await axios.get('/api/trees');
                setTrees(res.data);
                if (res.data.length > 0) {
                    setActiveTreeId(res.data[0].id);
                }
            } catch (e) {
                console.error("Failed to list trees", e);
            }
        }
        fetchTrees();
    }, []);

    // 2. Load Structure when Active Tree Changes
    useEffect(() => {
        if (activeTreeId) {
            loadTreeStructure(activeTreeId);
        }
    }, [activeTreeId]);

    // 3. CRITICAL FIX: Reset content when selection changes
    useEffect(() => {
        setContentPayload(null);
        setContentLoading(false);
    }, [selectedNode]);

    async function loadTreeStructure(id: string) {
        setLoading(true);
        try {
            const res = await axios.get(`/api/trees/${id}/structure`);
            setRawData(res.data);
            setSelectedNode(null); 
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function fetchContent() {
        if (!selectedNode?.contentId) return;
        setContentLoading(true);
        try {
            // Encode the ID because it might contain special chars (though UUIDs usually don't)
            const res = await axios.get(`/api/content/${encodeURIComponent(selectedNode.contentId)}`);
            setContentPayload(res.data.payload);
        } catch (e) {
            console.error("Failed to fetch content", e);
            setContentPayload("Error loading content. Check API logs.");
        } finally {
            setContentLoading(false);
        }
    }

    const refresh = () => {
        if (activeTreeId) loadTreeStructure(activeTreeId);
    };

    // Transform Flat Map -> Hierarchical Lookup
    const { rootNode, childrenMap } = useMemo(() => {
        if (!rawData || !rawData.nodes) return { rootNode: null, childrenMap: {} };

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

        return { rootNode: root, childrenMap: map };
    }, [rawData]);

    if (!activeTreeId && !loading && trees.length === 0) return <div className="p-8 text-red-500">No trees found.</div>;
    const activeTreeName = trees.find(t => t.id === activeTreeId)?.name || "Unknown Tree";

    return (
        <div className="flex h-screen bg-zinc-50 text-zinc-900">
            {/* Sidebar */}
            <div className="w-[400px] border-r bg-white flex flex-col shadow-sm z-10">
                <div className="p-4 border-b space-y-4">
                    <div className="flex items-center justify-between">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full justify-between font-bold text-lg h-12">
                                    <div className="flex items-center gap-2">
                                        <Database className="w-5 h-5 text-purple-600" />
                                        {activeTreeName}
                                    </div>
                                    <ChevronDown className="w-4 h-4 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[360px]">
                                {trees.map(t => (
                                    <DropdownMenuItem key={t.id} onClick={() => setActiveTreeId(t.id)}>
                                        <span className="font-bold mr-2">{t.name}</span>
                                        <span className="text-xs text-muted-foreground">({t.id})</span>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button variant="ghost" size="icon" onClick={refresh} title="Reload Tree">
                            <RefreshCw className="h-4 w-4"/>
                        </Button>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-zinc-400" />
                        <Input 
                            placeholder="Filter nodes..." 
                            className="pl-8" 
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                
                <ScrollArea className="flex-1">
                    <div className="p-2">
                        {loading ? (
                             <div className="flex justify-center p-8"><Loader2 className="animate-spin text-zinc-300" /></div>
                        ) : rootNode ? (
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

            {/* Main Content Details */}
            <div className="flex-1 overflow-y-auto p-8">
                {selectedNode ? (
                    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-mono bg-zinc-100 px-2 py-0.5 rounded text-zinc-500 border">
                                    {selectedNode.id}
                                </span>
                                {selectedNode.contentId && (
                                    <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                                        CONTENT ATOM
                                    </span>
                                )}
                            </div>
                            <h1 className="text-3xl font-bold leading-tight text-zinc-900">
                                {selectedNode.l0Gist}
                            </h1>
                        </div>

                        {selectedNode.l1Map && (
                            <Card>
                                <CardHeader className="bg-zinc-50/50 border-b pb-3">
                                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-zinc-500">
                                        Executive Summary
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-6 prose prose-zinc max-w-none text-sm leading-relaxed text-zinc-700 whitespace-pre-wrap">
                                    {selectedNode.l1Map.summary}
                                </CardContent>
                            </Card>
                        )}

                        {selectedNode.contentId && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-semibold text-lg flex items-center gap-2">
                                        <FileText className="w-5 h-5 text-blue-600" /> Raw Content
                                    </h3>
                                    <span className="text-xs font-mono text-muted-foreground">{selectedNode.contentId}</span>
                                </div>
                                
                                {contentPayload ? (
                                    <div className="bg-zinc-50 border rounded-lg p-6 overflow-auto max-h-[600px] shadow-inner">
                                        <pre className="text-xs font-mono text-zinc-700 whitespace-pre-wrap leading-relaxed">
                                            {contentPayload}
                                        </pre>
                                    </div>
                                ) : (
                                    <div className="p-8 border rounded-xl bg-white shadow-sm text-center">
                                        <p className="text-sm text-zinc-500 mb-4">Content is stored as an immutable atom.</p>
                                        <Button onClick={fetchContent} disabled={contentLoading} variant="outline">
                                            {contentLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                            Load Payload
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-300 space-y-4">
                        <Database className="w-16 h-16 opacity-10" />
                        <p className="text-lg font-medium">Select a node to inspect details.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
