import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { History, Loader2 } from "lucide-react";
import axios from "axios";

interface ReplaceVersionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    nodeId: string;
    currentContent: string;
    onComplete: (newContent: string, newContentId?: string) => void;
}

export function ReplaceVersionDialog({ open, onOpenChange, nodeId, currentContent, onComplete }: ReplaceVersionDialogProps) {
    const [content, setContent] = useState("");
    const [replacing, setReplacing] = useState(false);

    // Initialize with current content when dialog opens
    useEffect(() => {
        if (open) {
            setContent(currentContent);
        }
    }, [open, currentContent]);

    const handleReplace = async () => {
        if (!content.trim() || !nodeId) return;

        setReplacing(true);
        try {
            const res = await axios.post(`/api/nodes/${nodeId}/replace-version`, {
                content
            });
            onOpenChange(false);
            onComplete(content, res.data.newContent?.id);
        } catch (e) {
            console.error("Failed to replace version:", e);
        } finally {
            setReplacing(false);
        }
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setContent("");
        }
        onOpenChange(open);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <History className="w-5 h-5 text-amber-500" />
                        Replace Content Version
                    </DialogTitle>
                    <DialogDescription>
                        Create a new version of this content. The old version will be preserved in history.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                    <div>
                        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                            New Content
                        </label>
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            className="w-full mt-1 min-h-[300px] p-3 text-sm font-mono border rounded-lg resize-y"
                            placeholder="Enter the new content..."
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => handleOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleReplace}
                            disabled={!content.trim() || replacing}
                            className="bg-amber-600 hover:bg-amber-700"
                        >
                            {replacing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <History className="w-4 h-4" />
                            )}
                            Replace Version
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
