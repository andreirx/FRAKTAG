import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FolderPlus, Folder, Plus, X, Loader2 } from "lucide-react";
import axios from "axios";

interface CreateFolderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    treeId: string;
    parentId: string;
    onComplete: (newNode?: any) => void;
}

export function CreateFolderDialog({ open, onOpenChange, treeId, parentId, onComplete }: CreateFolderDialogProps) {
    const [folders, setFolders] = useState<{ title: string }[]>([{ title: "" }]);
    const [creating, setCreating] = useState(false);

    const addFolderRow = () => {
        setFolders(prev => [...prev, { title: "" }]);
    };

    const updateFolderTitle = (index: number, value: string) => {
        setFolders(prev => prev.map((f, i) => i === index ? { title: value } : f));
    };

    const removeFolderRow = (index: number) => {
        setFolders(prev => prev.filter((_, i) => i !== index));
    };

    const validFolders = folders.filter(f => f.title.trim());
    const canCreate = validFolders.length > 0;

    const handleCreate = async () => {
        if (!canCreate) return;

        setCreating(true);
        try {
            let lastCreatedNode = null;
            for (const folder of validFolders) {
                const res = await axios.post(`/api/trees/${treeId}/folders`, {
                    parentId,
                    title: folder.title,
                    gist: folder.title, // Use title as gist placeholder
                });
                lastCreatedNode = res.data;
            }
            onOpenChange(false);
            setFolders([{ title: "" }]);
            // Return the last created folder so it can be selected
            onComplete(lastCreatedNode);
        } catch (e) {
            console.error("Failed to create folders:", e);
        } finally {
            setCreating(false);
        }
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setFolders([{ title: "" }]);
        }
        onOpenChange(open);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <FolderPlus className="w-5 h-5 text-blue-500" />
                        Create New Folder{folders.length > 1 ? 's' : ''}
                    </DialogTitle>
                    <DialogDescription>
                        Create one or more subfolders. You can add descriptions later.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col flex-1 min-h-0 pt-4 gap-4">
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="space-y-2 pr-4">
                            {folders.map((folder, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <div className="flex-1 flex items-center gap-2 p-2 border rounded-lg bg-zinc-50/50">
                                        <Folder className="w-4 h-4 text-blue-500 shrink-0" />
                                        <Input
                                            value={folder.title}
                                            onChange={(e) => updateFolderTitle(index, e.target.value)}
                                            placeholder={`Folder ${folders.length > 1 ? index + 1 : ''} title...`}
                                            className="border-0 bg-transparent p-0 h-8 focus-visible:ring-0"
                                            autoFocus={index === folders.length - 1}
                                        />
                                    </div>
                                    {folders.length > 1 && (
                                        <button
                                            onClick={() => removeFolderRow(index)}
                                            className="p-2 text-zinc-400 hover:text-red-500 rounded shrink-0"
                                            title="Remove folder"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </ScrollArea>

                    <div className="flex-shrink-0 space-y-3 border-t pt-4">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={addFolderRow}
                            className="w-full border-dashed"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Add Another Folder
                        </Button>

                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => handleOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCreate}
                                disabled={!canCreate || creating}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                {creating ? (
                                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                ) : (
                                    <FolderPlus className="w-4 h-4 mr-2" />
                                )}
                                Create {validFolders.length > 1 ? `${validFolders.length} Folders` : 'Folder'}
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
