import { useEffect, useState, useMemo } from "react";
import axios from 'axios';
import { TreeItem, TreeNode } from "@/components/fraktag/TreeItem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, RefreshCw, Database, FileText, ChevronDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"; // npx shadcn@latest add dropdown-menu

export default function KnowledgeTree() {
    const [loading, setLoading] = useState(true);
    const [trees, setTrees] = useState<any[]>([]); // List of available trees
    const [activeTreeId, setActiveTreeId] = useState<string>(""); // Currently selected tree
    const [rawData, setRawData] = useState<any>(null);
    const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
    const [searchTerm, setSearchTerm] = useState("");

    const [contentPayload, setContentPayload] = useState<string | null>(null);

    // 1. Initial Load: Get List of Trees
    useEffect(() => {
        async function fetchTrees() {
            try {
                const res = await axios.get('/api/trees');
                setTrees(res.data);
                if (res.data.length > 0) {
                    // Default to the first tree found
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

    async function loadTreeStructure(id: string) {
        setLoading(true);
        try {
            const res = await axios.get(`/api/trees/${id}/structure`);
            setRawData(res.data);
            setSelectedNode(null); // Reset selection on tree switch
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
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

        // Simple Search Filtering
        // For visualizer, we just grey out non-matches or filter? 
        // Let's stick to full tree for structure, highlighting is complex without context.

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

    if (!activeTreeId && !loading && trees.length === 0) return <div className="p-8 text-red-500">No trees found in engine.</div>;

    const activeTreeName = trees.find(t => t.id === activeTreeId)?.name || "Unknown Tree";

    return (
        <div className="flex h-screen bg-zinc-50 text-zinc-900">
            {/* Sidebar */}
            <div className="w-[400px] border-r bg-white flex flex-col shadow-sm z-10">
                <div className="p-4 border-b space-y-4">
                    {/* Tree Switcher */}
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
                                <CardContent className="pt-6 prose prose-zinc max-w-none text-sm leading-relaxed text-zinc-700">
                                    {selectedNode.l1Map.summary}
                                </CardContent>
                            </Card>
                        )}

                        {selectedNode.contentId && (
                            <div className="p-8 border rounded-xl bg-white shadow-sm text-center space-y-4">
                                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto text-blue-600">
                                    <FileText className="w-8 h-8" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg">Raw Content Available</h3>
                                    <p className="text-sm text-zinc-500 max-w-sm mx-auto mt-1">
                                        This node is linked to an immutable content atom.
                                        <br/>
                                        <span className="font-mono text-xs">{selectedNode.contentId}</span>
                                    </p>
                                </div>
                                {contentPayload ? (
                                    <div className="text-left bg-zinc-50 p-4 rounded border text-xs font-mono whitespace-pre-wrap max-h-96 overflow-auto">
                                        {contentPayload}
                                    </div>
                                ) : (
                                    <Button variant="outline" onClick={async () => {
                                        try {
                                            const res = await axios.get(`/api/content/${selectedNode.contentId}`);
                                            setContentPayload(res.data.payload);
                                        } catch(e) { console.error(e); }
                                    }}>
                                        Fetch Content Payload
                                    </Button>
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
