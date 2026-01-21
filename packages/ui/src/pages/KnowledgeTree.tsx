// packages/ui/src/pages/KnowledgeTree.tsx

import { useEffect, useState, useMemo } from "react";
import axios from 'axios';
import { TreeItem, TreeNode } from "@/components/fraktag/TreeItem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, RefreshCw, Database, FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function KnowledgeTree() {
    const [loading, setLoading] = useState(true);
    const [rawData, setRawData] = useState<any>(null);
    const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
    const [searchTerm, setSearchTerm] = useState("");

    async function load() {
        setLoading(true);
        try {
            const res = await axios.get('/api/trees/notes/structure');
            setRawData(res.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    // Transform Flat Map -> Hierarchical Lookup
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

        // Sort children
        Object.keys(map).forEach(key => {
            map[key].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        });

        return { rootNode: root, childrenMap: map, flatList: nodes };
    }, [rawData]);

    // FILTER LOGIC
    const filteredNodes = useMemo(() => {
        if (!searchTerm) return null;
        return flatList.filter(n => n.l0Gist.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [searchTerm, flatList]);


    if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-zinc-400" /></div>;
    if (!rootNode) return <div className="p-8 text-red-500">Failed to load tree. Is the API running?</div>;

    return (
        <div className="flex h-screen bg-zinc-50">
            {/* Sidebar */}
            <div className="w-[400px] border-r bg-white flex flex-col">
                <div className="p-4 border-b space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold text-lg text-zinc-800">
                            <Database className="w-5 h-5" />
                            FRAKTAG
                        </div>
                        <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="h-4 w-4"/></Button>
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
                        {/* CONDITIONAL RENDERING: Search vs Tree */}
                        {searchTerm ? (
                            <div className="space-y-1">
                                {filteredNodes?.map(node => (
                                    <div
                                        key={node.id}
                                        onClick={() => setSelectedNode(node)}
                                        className="p-2 text-sm hover:bg-zinc-100 cursor-pointer rounded flex items-center gap-2 truncate"
                                    >
                                        <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                                        <span className="truncate">{node.l0Gist}</span>
                                    </div>
                                ))}
                                {filteredNodes?.length === 0 && (
                                    <div className="text-center text-sm text-zinc-400 p-4">No results found.</div>
                                )}
                            </div>
                        ) : (
                            <TreeItem
                                node={rootNode}
                                childrenMap={childrenMap}
                                onSelect={setSelectedNode}
                                selectedId={selectedNode?.id}
                            />
                        )}
                    </div>
                </ScrollArea>
            </div>

            {/* Main Content (Unchanged) */}
            <div className="flex-1 overflow-y-auto p-8">
                {selectedNode ? (
                    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-mono bg-zinc-100 px-2 py-0.5 rounded text-zinc-500 border">
                                    {selectedNode.id}
                                </span>
                                {selectedNode.contentId && (
                                    <span className="text-xs font-mono bg-blue-50 px-2 py-0.5 rounded text-blue-600 border border-blue-100">
                                        LEAF
                                    </span>
                                )}
                            </div>
                            <h1 className="text-3xl font-bold text-zinc-900 leading-tight">
                                {selectedNode.l0Gist}
                            </h1>
                        </div>

                        {selectedNode.l1Map && (
                            <Card>
                                <CardHeader className="bg-zinc-50/50 border-b pb-3">
                                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-zinc-500">
                                        Executive Summary (L1)
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-6 prose prose-zinc max-w-none text-sm leading-relaxed">
                                    {selectedNode.l1Map.summary}
                                </CardContent>
                            </Card>
                        )}

                        {selectedNode.contentId && (
                            <div className="p-8 border rounded-xl bg-white shadow-sm text-center space-y-3">
                                <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto text-blue-600">
                                    <FileText className="w-6 h-6" />
                                </div>
                                <h3 className="font-semibold">Raw Content Available</h3>
                                <p className="text-sm text-zinc-500 max-w-xs mx-auto">
                                    This node contains raw text data (ID: {selectedNode.contentId.slice(0,8)}...).
                                </p>
                                <Button variant="outline">Fetch Content Payload</Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-4">
                        <Database className="w-12 h-12 opacity-20" />
                        <p>Select a node to inspect details.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
