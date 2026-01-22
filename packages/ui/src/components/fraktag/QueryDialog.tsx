import { useState } from "react";
import axios from "axios";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Sparkles,
  MessageSquare,
  Compass,
  X,
} from "lucide-react";

interface RetrieveResult {
  nodes: { nodeId: string; path: string; resolution: string; content: string }[];
  navigationPath: string[];
}

interface AskResult {
  answer: string;
  references: string[];
}

interface QueryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  treeId: string;
  treeName: string;
}

export function QueryDialog({
  open,
  onOpenChange,
  treeId,
  treeName,
}: QueryDialogProps) {
  const [queryText, setQueryText] = useState("");
  const [retrieveLoading, setRetrieveLoading] = useState(false);
  const [askLoading, setAskLoading] = useState(false);
  const [retrieveResults, setRetrieveResults] = useState<RetrieveResult | null>(null);
  const [askAnswer, setAskAnswer] = useState<AskResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Retrieve: Find relevant fragments
  async function handleRetrieve() {
    if (!queryText.trim() || !treeId) return;
    setRetrieveLoading(true);
    setQueryError(null);
    setAskAnswer(null);
    try {
      const res = await axios.post("/api/retrieve", {
        treeId,
        query: queryText,
        maxDepth: 5,
        resolution: "L2",
      });
      setRetrieveResults(res.data);
    } catch (e: any) {
      console.error("Retrieve failed:", e);
      setQueryError(e.response?.data?.error || e.message || "Retrieve failed");
    } finally {
      setRetrieveLoading(false);
    }
  }

  // Ask: Get AI answer using retrieved content
  async function handleAsk() {
    if (!queryText.trim() || !treeId) return;
    setAskLoading(true);
    setQueryError(null);
    setRetrieveResults(null);
    try {
      const res = await axios.post("/api/ask", {
        query: queryText,
        treeId,
      });
      setAskAnswer(res.data);
    } catch (e: any) {
      console.error("Ask failed:", e);
      setQueryError(e.response?.data?.error || e.message || "Ask failed");
    } finally {
      setAskLoading(false);
    }
  }

  // Clear query results
  function clearQueryResults() {
    setRetrieveResults(null);
    setAskAnswer(null);
    setQueryError(null);
  }

  // Reset on close
  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      setTimeout(() => {
        setQueryText("");
        clearQueryResults();
      }, 300);
    }
    onOpenChange(newOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[90vw] max-w-6xl h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            Query Knowledge Base: {treeName}
          </DialogTitle>
          <DialogDescription>
            Search for relevant content or ask questions about the knowledge base.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 space-y-4 pt-4">
          {/* Query Input */}
          <div className="flex gap-2">
            <Input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Enter your query..."
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAsk();
                }
              }}
            />
            <Button
              variant="outline"
              onClick={handleRetrieve}
              disabled={!queryText.trim() || retrieveLoading || askLoading}
              className="gap-2"
            >
              {retrieveLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Compass className="w-4 h-4" />
              )}
              Retrieve
            </Button>
            <Button
              onClick={handleAsk}
              disabled={!queryText.trim() || retrieveLoading || askLoading}
              className="gap-2 bg-purple-600 hover:bg-purple-700"
            >
              {askLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MessageSquare className="w-4 h-4" />
              )}
              Ask
            </Button>
          </div>

          {/* Loading Indicator */}
          {(retrieveLoading || askLoading) && (
            <div className="flex items-center gap-3 text-purple-600 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3">
              <Loader2 className="w-5 h-5 animate-spin" />
              <div>
                <div className="font-medium text-sm">
                  {retrieveLoading ? "Searching knowledge base..." : "AI is thinking..."}
                </div>
                <div className="text-xs text-purple-500">
                  {retrieveLoading
                    ? "Finding relevant content fragments"
                    : "Retrieving context and generating answer"}
                </div>
              </div>
            </div>
          )}

          {/* Error Display */}
          {queryError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
              <span className="font-medium">Error:</span> {queryError}
            </div>
          )}

          {/* Results Area */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-4 pr-4">
              {/* Ask Answer */}
              {askAnswer && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-purple-700 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Answer
                    </h3>
                    <Button variant="ghost" size="sm" onClick={clearQueryResults} className="text-xs">
                      <X className="w-3 h-3 mr-1" /> Clear
                    </Button>
                  </div>
                  <div className="bg-zinc-50 rounded-lg border p-4 text-sm leading-relaxed whitespace-pre-wrap">
                    {askAnswer.answer}
                  </div>
                  {askAnswer.references.length > 0 && (
                    <div className="text-xs text-zinc-500">
                      <span className="font-medium">References:</span>{" "}
                      {askAnswer.references.join(", ")}
                    </div>
                  )}
                </div>
              )}

              {/* Retrieve Results */}
              {retrieveResults && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-purple-700 flex items-center gap-2">
                      <Compass className="w-4 h-4" />
                      Retrieved Fragments ({retrieveResults.nodes.length})
                    </h3>
                    <Button variant="ghost" size="sm" onClick={clearQueryResults} className="text-xs">
                      <X className="w-3 h-3 mr-1" /> Clear
                    </Button>
                  </div>
                  {retrieveResults.navigationPath.length > 0 && (
                    <div className="text-xs text-zinc-500 bg-zinc-50 rounded px-3 py-2 border">
                      <span className="font-medium">Navigation Path:</span>{" "}
                      {retrieveResults.navigationPath.join(" → ")}
                    </div>
                  )}
                  <div className="space-y-2">
                    {retrieveResults.nodes.map((node, i) => (
                      <div key={i} className="bg-zinc-50 rounded-lg border p-4 space-y-2">
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                          <span className="font-mono bg-zinc-200 px-2 py-0.5 rounded">
                            {node.resolution}
                          </span>
                          <span className="truncate">{node.path}</span>
                        </div>
                        <div className="text-sm leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto bg-white rounded p-3 border">
                          {node.content}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {!askAnswer && !retrieveResults && !retrieveLoading && !askLoading && !queryError && (
                <div className="h-[300px] flex flex-col items-center justify-center text-zinc-400 space-y-4">
                  <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center">
                    <Sparkles className="w-8 h-8 opacity-30" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium">Enter a query to search</p>
                    <p className="text-sm text-zinc-400 mt-1">
                      <strong>Retrieve</strong> finds relevant fragments | <strong>Ask</strong> generates an AI answer
                    </p>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
