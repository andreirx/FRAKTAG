import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilePlus, Loader2 } from "lucide-react";
import axios from "axios";

interface CreateNoteDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    treeId: string;
    parentId: string;
    onComplete: (newNode?: any) => void;
}

export function CreateNoteDialog({ open, onOpenChange, treeId, parentId, onComplete }: CreateNoteDialogProps) {
    const [title, setTitle] = useState("");
    const [creating, setCreating] = useState(false);

    const handleCreate = async () => {
        if (!title.trim()) return;

        setCreating(true);
        try {
            const res = await axios.post(`/api/trees/${treeId}/editable-documents`, {
                folderId: parentId,
                title,
                content: '',
                gist: ''
            });
            onOpenChange(false);
            setTitle("");
            onComplete(res.data);
        } catch (e) {
            console.error("Failed to create note:", e);
        } finally {
            setCreating(false);
        }
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setTitle("");
        }
        onOpenChange(open);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FilePlus className="w-5 h-5 text-emerald-500" />
                        Create New Note
                    </DialogTitle>
                    <DialogDescription>
                        Create an editable note that you can write and edit directly.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                    <div>
                        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                            Note Title
                        </label>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Enter note title..."
                            className="mt-1"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && title.trim()) {
                                    handleCreate();
                                }
                            }}
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => handleOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCreate}
                            disabled={!title.trim() || creating}
                            className="bg-emerald-600 hover:bg-emerald-700"
                        >
                            {creating ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <FilePlus className="w-4 h-4" />
                            )}
                            Create Note
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
