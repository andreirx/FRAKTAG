import { useState, useRef, useEffect } from "react";
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
  FileText,
  ShieldCheck
} from "lucide-react";
import { SourcePopup, StreamingSourceData } from "./SourcePopup";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface RetrieveResult {
  nodes: { nodeId: string; path: string; resolution: string; content: string }[];
  navigationPath: string[];
}

interface StreamingSource {
  index: number;
  title: string;
  path: string;
  sourceInfo: string;
  preview: string;
  gist: string;
  nodeId: string;
  contentId: string;
  fullContent: string;
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
  const [queryError, setQueryError] = useState<string | null>(null);

  // Streaming state
  const [streamingSources, setStreamingSources] = useState<StreamingSource[]>([]);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingReferences, setStreamingReferences] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Auto-scroll ref
  const answerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Source hover/click state
  const [hoveredSource, setHoveredSource] = useState<StreamingSource | null>(null);
  const [popupSource, setPopupSource] = useState<StreamingSourceData | null>(null);

  // Auto-scroll as answer streams
  useEffect(() => {
    if (answerRef.current && streamingAnswer) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [streamingAnswer]);

  // Cleanup on unmount or dialog close
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Retrieve: Find relevant fragments (non-streaming)
  async function handleRetrieve() {
    if (!queryText.trim() || !treeId) return;
    setRetrieveLoading(true);
    setQueryError(null);
    clearStreamingState();

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

  // Ask: Get AI answer with streaming via POST (to handle large inputs)
  async function handleAsk() {
    if (!queryText.trim() || !treeId) return;

    // Clear previous results
    setQueryError(null);
    setRetrieveResults(null);
    clearStreamingState();
    setAskLoading(true);
    setIsStreaming(true);

    // Cancel any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Fetch with POST to send large body
      const response = await fetch('/api/ask/stream', {
        method: 'POST', // Changed from GET to POST for large payloads
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: queryText,
          treeId: treeId, // Single tree context for this dialog
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(response.statusText);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;

          const lines = part.split('\n');
          let eventType = "";
          let dataStr = "";

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            if (line.startsWith('data: ')) dataStr = line.slice(6);
          }

          if (eventType && dataStr) {
            try {
              const data = JSON.parse(dataStr);

              if (eventType === 'source') {
                setStreamingSources(prev => [...prev, data]);
              } else if (eventType === 'chunk') {
                const text = data.text || "";
                setStreamingAnswer(prev => prev + text);
                setAskLoading(false); // First chunk received
              } else if (eventType === 'done') {
                setStreamingReferences(data.references || []);
              } else if (eventType === 'error') {
                setQueryError(data.message);
              }
            } catch (e) {
              console.error("Error parsing SSE data", e);
            }
          }
        }
      }

    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setQueryError(e.message || "Unknown error");
    } finally {
      setIsStreaming(false);
      setAskLoading(false);
      abortControllerRef.current = null;
    }
  }

  // Clear streaming state
  function clearStreamingState() {
    setStreamingSources([]);
    setStreamingAnswer("");
    setStreamingReferences([]);
    setIsStreaming(false);
  }

  // Clear all results
  function clearQueryResults() {
    setRetrieveResults(null);
    clearStreamingState();
    setQueryError(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  // Reset on close
  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setTimeout(() => {
        setQueryText("");
        clearQueryResults();
      }, 300);
    }
    onOpenChange(newOpen);
  }

  const hasStreamingContent = streamingSources.length > 0 || streamingAnswer;

  return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="w-[90vw] max-w-6xl h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-purple-600" />
              Private Ask the KB: {treeName}
            </DialogTitle>
            <DialogDescription>
              Securely query this specific knowledge tree. No data leaves your infrastructure.
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
                  disabled={!queryText.trim() || retrieveLoading || askLoading || isStreaming}
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
                  disabled={!queryText.trim() || retrieveLoading || askLoading || isStreaming}
                  className="gap-2 bg-purple-600 hover:bg-purple-700"
              >
                {(askLoading || isStreaming) ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <MessageSquare className="w-4 h-4" />
                )}
                Ask
              </Button>
            </div>

            {/* Loading Indicator */}
            {(retrieveLoading || askLoading) && !streamingAnswer && (
                <div className="flex items-center gap-3 text-purple-600 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <div>
                    <div className="font-medium text-sm">
                      {retrieveLoading ? "Searching knowledge base..." : "AI is thinking..."}
                    </div>
                    <div className="text-xs text-purple-500">
                      {retrieveLoading
                          ? "Finding relevant content fragments"
                          : streamingSources.length > 0
                              ? `Found ${streamingSources.length} sources, generating answer...`
                              : "Retrieving context..."}
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
                {/* Streaming Ask - Sources as they're discovered */}
                {hasStreamingContent && (
                    <div className="space-y-4">
                      {/* Sources being discovered */}
                      {streamingSources.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-semibold text-emerald-700 flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                Sources Found ({streamingSources.length})
                                {isStreaming && !streamingAnswer && (
                                    <Loader2 className="w-3 h-3 animate-spin text-emerald-500" />
                                )}
                              </h3>
                              {!isStreaming && (
                                  <Button variant="ghost" size="sm" onClick={clearQueryResults} className="text-xs">
                                    <X className="w-3 h-3 mr-1" /> Clear
                                  </Button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {streamingSources.map((source, i) => (
                                  <div
                                      key={i}
                                      className="relative bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs animate-in fade-in slide-in-from-left-2 duration-300 cursor-pointer hover:bg-emerald-100 hover:border-emerald-300 transition-colors"
                                      onMouseEnter={() => setHoveredSource(source)}
                                      onMouseLeave={() => setHoveredSource(null)}
                                      onClick={() => setPopupSource({
                                        index: source.index,
                                        title: source.title,
                                        gist: source.gist,
                                        fullContent: source.fullContent,
                                        path: source.path,
                                        nodeId: source.nodeId
                                      })}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-emerald-700">[{source.index}]</span>
                                      <span className="font-medium text-emerald-800 max-w-[200px] truncate">
                                {source.title}
                              </span>
                                    </div>
                                    {source.sourceInfo && (
                                        <div className="text-emerald-600 text-[10px] mt-0.5">
                                          {source.sourceInfo}
                                        </div>
                                    )}
                                    {/* Hover Tooltip showing gist - positioned below */}
                                    {hoveredSource === source && source.gist && (
                                        <div className="absolute z-50 top-full left-0 mt-2 w-72 p-3 bg-zinc-900 text-white text-xs rounded-lg shadow-xl pointer-events-none animate-in fade-in zoom-in-95 duration-150">
                                          <div className="absolute top-0 left-4 transform -translate-y-1/2 rotate-45 w-2 h-2 bg-zinc-900"></div>
                                          <div className="font-semibold text-emerald-300 mb-1">Summary:</div>
                                          <div className="text-zinc-200 leading-relaxed">{source.gist}</div>
                                        </div>
                                    )}
                                  </div>
                              ))}
                            </div>
                          </div>
                      )}

                      {/* Streaming Answer */}
                      {(streamingAnswer || (isStreaming && streamingSources.length > 0)) && (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-semibold text-purple-700 flex items-center gap-2">
                                <MessageSquare className="w-4 h-4" />
                                Answer
                                {isStreaming && (
                                    <span className="flex items-center gap-1 text-xs font-normal text-purple-500">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              streaming...
                            </span>
                                )}
                              </h3>
                            </div>
                            <div
                                ref={answerRef}
                                className="bg-zinc-50 rounded-lg border p-4 text-sm leading-relaxed"
                            >
                              {streamingAnswer ? (
                                  <>
                                    <MarkdownRenderer content={streamingAnswer} />
                                    {isStreaming && (
                                        <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-0.5" />
                                    )}
                                  </>
                              ) : (
                                  <span className="text-zinc-400 italic flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating answer...
                          </span>
                              )}
                            </div>
                            {!isStreaming && streamingReferences.length > 0 && (
                                <div className="text-xs text-zinc-500">
                                  <span className="font-medium">References:</span>{" "}
                                  {streamingReferences.join(", ")}
                                </div>
                            )}
                          </div>
                      )}
                    </div>
                )}

                {/* Retrieve Results (non-streaming) */}
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
                {!hasStreamingContent && !retrieveResults && !retrieveLoading && !askLoading && !queryError && (
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

        {/* Shared Source Content Popup */}
        <SourcePopup
            open={!!popupSource}
            onOpenChange={(open) => !open && setPopupSource(null)}
            source={popupSource || undefined}
            index={popupSource?.index}
        />
      </Dialog>
  );
}
