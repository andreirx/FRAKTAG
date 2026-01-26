import { useState, useEffect } from "react";
import axios from "axios";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, FileText } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";

// For streaming sources (already have full data)
export interface StreamingSourceData {
  index?: number;
  title: string;
  gist: string;
  fullContent: string;
  path?: string;
  nodeId: string;
}

// For hydrated references (fetched from API)
export interface HydratedNodeData {
  nodeId: string;
  title: string;
  gist: string;
  content: string;
  type: string;
  path: string;
}

interface SourcePopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Either provide full source data (streaming) or just nodeId (for hydration)
  source?: StreamingSourceData | null;
  nodeId?: string | null;
  index?: number;
}

export function SourcePopup({
  open,
  onOpenChange,
  source,
  nodeId,
  index,
}: SourcePopupProps) {
  const [hydratedData, setHydratedData] = useState<HydratedNodeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If we only have nodeId, fetch the full data
  useEffect(() => {
    if (open && nodeId && !source) {
      setLoading(true);
      setError(null);
      axios
        .get(`/api/nodes/${nodeId}`)
        .then((res) => {
          setHydratedData(res.data);
        })
        .catch((e) => {
          setError(e.response?.data?.error || e.message || "Failed to load source");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, nodeId, source]);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setHydratedData(null);
      setError(null);
    }
  }, [open]);

  // Determine what data to display
  const title = source?.title || hydratedData?.title || "Source";
  const gist = source?.gist || hydratedData?.gist || "";
  const content = source?.fullContent || hydratedData?.content || "";
  const displayIndex = source?.index || index;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            {displayIndex && <span className="text-emerald-700">[{displayIndex}]</span>}
            {title}
          </DialogTitle>
          <DialogDescription>
            {displayIndex ? `Source ${displayIndex}` : "Source reference"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-3 text-purple-600">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Loading source content...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col gap-4 pt-4 overflow-hidden">
            {/* Gist/Summary */}
            {gist && (
              <div className="shrink-0 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-2">
                  Summary
                </div>
                <div className="text-sm text-emerald-800">{gist}</div>
              </div>
            )}
            {/* Full Content - scrollable */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="shrink-0 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Full Content
              </div>
              <div className="flex-1 min-h-0 border rounded-lg bg-white overflow-auto p-4">
                <MarkdownRenderer content={content} />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
