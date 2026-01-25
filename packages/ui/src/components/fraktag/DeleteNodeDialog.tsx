import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash2, Loader2 } from "lucide-react";
import axios from "axios";

interface DeleteNodeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    nodeId: string;
    nodeTitle: string;
    nodeType: string;
    onComplete: () => void;
}

export function DeleteNodeDialog({ open, onOpenChange, nodeId, nodeTitle, nodeType, onComplete }: DeleteNodeDialogProps) {
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async () => {
        if (!nodeId) return;

        setDeleting(true);
        try {
            await axios.delete(`/api/nodes/${nodeId}`);
            onOpenChange(false);
            onComplete();
        } catch (e) {
            console.error("Failed to delete node:", e);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-red-600">
                        <AlertTriangle className="w-5 h-5" />
                        Delete Content
                    </DialogTitle>
                    <DialogDescription>
                        This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <p className="text-sm text-red-800 font-medium mb-2">
                            Are you sure you want to delete this {nodeType}?
                        </p>
                        <p className="text-sm text-red-700">
                            <strong>"{nodeTitle}"</strong>
                        </p>
                        {nodeType === 'document' && (
                            <p className="text-xs text-red-600 mt-2">
                                This will also delete all fragments (chunks) inside this document.
                            </p>
                        )}
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleDelete}
                            disabled={deleting}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deleting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Trash2 className="w-4 h-4" />
                            )}
                            Yes, Delete Forever
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
