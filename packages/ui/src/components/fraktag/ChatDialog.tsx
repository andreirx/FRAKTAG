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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  MessageSquare,
  Send,
  User,
  Bot,
  FileText,
  Trash2,
  ChevronDown,
  ChevronRight,
  Plus,
  Database,
  MessagesSquare,
} from "lucide-react";
import { SourcePopup, StreamingSourceData } from "./SourcePopup";

interface Tree {
  id: string;
  name: string;
}

interface ConversationSession {
  id: string;
  treeId: string;
  title: string;
  startedAt: string;
  turnCount: number;
}

// References are just nodeIds - content is hydrated on demand
interface TurnReference {
  nodeId: string;
}

interface ConversationTurn {
  turnIndex: number;
  question: string;
  answer: string;
  references: TurnReference[];
  timestamp: string;
  folderId: string;
}

// For displaying hydrated reference data in the list
interface HydratedReference {
  nodeId: string;
  title: string;
  gist: string;
}

interface StreamingSource {
  index: number;
  title: string;
  path: string;
  preview: string;
  fullContent: string;
  gist: string;
  nodeId: string;
  treeId: string;
}

interface ChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kbId: string;
  kbName: string;
  trees: Tree[];
  defaultTreeId?: string;
}

export function ChatDialog({
  open,
  onOpenChange,
  kbId,
  kbName,
  trees,
  defaultTreeId,
}: ChatDialogProps) {
  // Tree selection state
  const [selectedTreeIds, setSelectedTreeIds] = useState<Set<string>>(new Set());
  const [showTreeSelector, setShowTreeSelector] = useState(true);

  // Session state
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ConversationSession | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showSessionList, setShowSessionList] = useState(false);

  // Turns state
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [loadingTurns, setLoadingTurns] = useState(false);

  // Chat state
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingSources, setStreamingSources] = useState<StreamingSource[]>([]);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingQuestion, setStreamingQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Source hover/click state (for streaming sources)
  const [hoveredSource, setHoveredSource] = useState<StreamingSource | null>(null);

  // Reference hover state (for persisted turn references)
  const [hoveredRef, setHoveredRef] = useState<{ turnId: string; refIndex: number } | null>(null);

  // Hydrated reference data (fetched for display)
  const [hydratedRefs, setHydratedRefs] = useState<Map<string, HydratedReference>>(new Map());

  // Unified popup state - either a streaming source or a nodeId to hydrate
  const [popupSource, setPopupSource] = useState<StreamingSourceData | null>(null);
  const [popupNodeId, setPopupNodeId] = useState<string | null>(null);
  const [popupIndex, setPopupIndex] = useState<number | undefined>(undefined);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Scroll to bottom when turns update
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [turns, streamingAnswer]);

  // Initialize on open
  useEffect(() => {
    if (open && kbId) {
      loadSessions();
      // Default to selecting the default tree if provided
      if (defaultTreeId && trees.some(t => t.id === defaultTreeId)) {
        setSelectedTreeIds(new Set([defaultTreeId]));
      }
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [open, kbId, defaultTreeId, trees]);

  // Load turns when session changes
  useEffect(() => {
    if (currentSession) {
      loadTurns(currentSession.id);
      setShowTreeSelector(false);
    } else {
      setTurns([]);
      setShowTreeSelector(true);
    }
  }, [currentSession?.id]);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await axios.get(`/api/knowledge-bases/${kbId}/conversations`);
      setSessions(res.data);
    } catch (e: any) {
      console.error("Failed to load sessions:", e);
    } finally {
      setLoadingSessions(false);
    }
  };

  const createSessionWithQuestion = async (question: string): Promise<ConversationSession> => {
    // Generate a short gist for the session title
    const gist = question.length > 60 ? question.slice(0, 60).trim() + "..." : question;
    const res = await axios.post(`/api/knowledge-bases/${kbId}/conversations`, {
      title: gist,
    });
    return res.data;
  };

  const loadTurns = async (sessionId: string) => {
    setLoadingTurns(true);
    try {
      const res = await axios.get(`/api/conversations/${sessionId}/turns`);
      const loadedTurns: ConversationTurn[] = res.data;
      setTurns(loadedTurns);

      // Hydrate references - fetch node data for display
      const nodeIds = new Set<string>();
      for (const turn of loadedTurns) {
        for (const ref of turn.references) {
          nodeIds.add(ref.nodeId);
        }
      }

      // Fetch all unique nodes
      const newHydrated = new Map<string, HydratedReference>();
      await Promise.all(
        Array.from(nodeIds).map(async (nodeId) => {
          try {
            const nodeRes = await axios.get(`/api/nodes/${nodeId}`);
            newHydrated.set(nodeId, {
              nodeId: nodeRes.data.nodeId,
              title: nodeRes.data.title,
              gist: nodeRes.data.gist,
            });
          } catch (e) {
            // Node might be deleted - use fallback
            newHydrated.set(nodeId, {
              nodeId,
              title: "Source (unavailable)",
              gist: "",
            });
          }
        })
      );
      setHydratedRefs(newHydrated);
    } catch (e: any) {
      console.error("Failed to load turns:", e);
    } finally {
      setLoadingTurns(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!confirm("Delete this conversation?")) return;
    try {
      await axios.delete(`/api/conversations/${sessionId}`);
      if (currentSession?.id === sessionId) {
        setCurrentSession(null);
        setTurns([]);
      }
      await loadSessions();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const startNewConversation = () => {
    setCurrentSession(null);
    setTurns([]);
    setShowSessionList(false);
    setShowTreeSelector(true);
  };

  const toggleTreeSelection = (treeId: string) => {
    setSelectedTreeIds(prev => {
      const next = new Set(prev);
      if (next.has(treeId)) {
        next.delete(treeId);
      } else {
        next.add(treeId);
      }
      return next;
    });
  };

  const selectAllTrees = () => {
    setSelectedTreeIds(new Set(trees.map(t => t.id)));
  };

  const clearTreeSelection = () => {
    setSelectedTreeIds(new Set());
  };

  const handleSend = async () => {
    if (!inputText.trim() || isStreaming || selectedTreeIds.size === 0) return;

    const question = inputText.trim();
    setInputText("");
    setError(null);
    setStreamingSources([]);
    setStreamingAnswer("");
    setStreamingQuestion(question);
    setIsStreaming(true);

    // Close any existing EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      // If no current session, create one with the question as title
      let sessionId = currentSession?.id;
      if (!sessionId) {
        const newSession = await createSessionWithQuestion(question);
        setCurrentSession(newSession);
        sessionId = newSession.id;
        await loadSessions(); // Refresh sessions list
      } else {
        // Update session title with latest question gist
        const gist = question.length > 60 ? question.slice(0, 60).trim() + "..." : question;
        await axios.patch(`/api/conversations/${sessionId}`, { title: gist });
      }

      // Build SSE URL with multiple tree IDs
      const params = new URLSearchParams({
        kbId,
        sessionId,
        question,
      });
      // Add each selected tree ID
      selectedTreeIds.forEach(id => params.append("treeIds", id));
      const url = `/api/chat/stream?${params.toString()}`;

      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.addEventListener("source", (e) => {
        const data = JSON.parse(e.data);
        setStreamingSources((prev) => [...prev, data]);
      });

      eventSource.addEventListener("answer_chunk", (e) => {
        const data = JSON.parse(e.data);
        setStreamingAnswer((prev) => prev + data.text);
      });

      eventSource.addEventListener("done", async () => {
        eventSource.close();
        // Reload turns FIRST, then clear streaming state
        // This prevents the flash where nothing is shown
        if (sessionId) {
          await loadTurns(sessionId);
        }
        // Now clear streaming state after turns are loaded
        setIsStreaming(false);
        setStreamingSources([]);
        setStreamingAnswer("");
        setStreamingQuestion("");
        // Reload sessions to update turn count
        await loadSessions();
      });

      eventSource.addEventListener("error", (e) => {
        try {
          const data = JSON.parse((e as any).data);
          setError(data.message || "Stream error");
        } catch {
          if (eventSource.readyState !== EventSource.CLOSED) {
            setError("Connection error");
          }
        }
        setIsStreaming(false);
        eventSource.close();
      });

      eventSource.onerror = () => {
        if (eventSource.readyState !== EventSource.CONNECTING) {
          setIsStreaming(false);
          eventSource.close();
        }
      };
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
      setIsStreaming(false);
    }
  };

  // Separate trees into knowledge trees and conversation trees
  const knowledgeTrees = trees.filter(t => !t.id.startsWith("conversations-"));
  const conversationTrees = trees.filter(t => t.id.startsWith("conversations-"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-purple-600" />
              Chat with {kbName || "Internal Knowledge Base"}
            </DialogTitle>
            <DialogDescription>
              {selectedTreeIds.size === 0
                ? "Select trees to search"
                : `Searching ${selectedTreeIds.size} tree${selectedTreeIds.size > 1 ? "s" : ""}`}
            </DialogDescription>
          </DialogHeader>

          {/* Session Selector / New Conversation */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setShowSessionList(!showSessionList)}
              className="flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900"
            >
              {showSessionList ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <MessagesSquare className="w-4 h-4" />
              {currentSession ? (
                <>
                  <span className="truncate max-w-[200px]">{currentSession.title}</span>
                  <span className="text-xs text-zinc-400">
                    ({currentSession.turnCount} turns)
                  </span>
                </>
              ) : (
                <span className="text-purple-600 font-medium">New Conversation</span>
              )}
            </button>
            {currentSession && (
              <Button
                size="sm"
                variant="ghost"
                onClick={startNewConversation}
                className="h-7 text-xs gap-1"
              >
                <Plus className="w-3 h-3" />
                New
              </Button>
            )}
          </div>

          {/* Session List Dropdown */}
          {showSessionList && (
            <div className="mt-2 p-2 bg-zinc-50 rounded-lg border max-h-40 overflow-y-auto">
              <div
                onClick={startNewConversation}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer ${
                  !currentSession ? "bg-purple-100" : "hover:bg-zinc-100"
                }`}
              >
                <Plus className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-medium text-purple-600">New Conversation</span>
              </div>
              {loadingSessions ? (
                <div className="text-center py-2">
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-2">No previous conversations</p>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer ${
                      currentSession?.id === session.id
                        ? "bg-purple-100"
                        : "hover:bg-zinc-100"
                    }`}
                    onClick={() => {
                      setCurrentSession(session);
                      setShowSessionList(false);
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{session.title}</div>
                      <div className="text-xs text-zinc-400">
                        {session.turnCount} turns · {new Date(session.startedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(session.id);
                      }}
                      className="shrink-0 text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Tree Selector - shown when no session or starting new */}
        {showTreeSelector && (
          <div className="shrink-0 px-6 py-3 border-b bg-zinc-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Select Knowledge Sources
              </span>
              <div className="flex gap-2">
                <button
                  onClick={selectAllTrees}
                  className="text-xs text-purple-600 hover:text-purple-800"
                >
                  Select All
                </button>
                <button
                  onClick={clearTreeSelection}
                  className="text-xs text-zinc-500 hover:text-zinc-700"
                >
                  Clear
                </button>
              </div>
            </div>
            <ScrollArea className="max-h-32">
              <div className="space-y-1">
                {/* Knowledge Trees */}
                {knowledgeTrees.length > 0 && (
                  <>
                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider pt-1">
                      Knowledge Trees
                    </div>
                    {knowledgeTrees.map((tree) => (
                      <label
                        key={tree.id}
                        className="flex items-center gap-2 p-1.5 rounded hover:bg-zinc-100 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedTreeIds.has(tree.id)}
                          onCheckedChange={() => toggleTreeSelection(tree.id)}
                        />
                        <Database className="w-3 h-3 text-purple-500" />
                        <span className="text-sm truncate">{tree.name}</span>
                      </label>
                    ))}
                  </>
                )}
                {/* Conversation Trees */}
                {conversationTrees.length > 0 && (
                  <>
                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider pt-2">
                      Conversation History
                    </div>
                    {conversationTrees.map((tree) => (
                      <label
                        key={tree.id}
                        className="flex items-center gap-2 p-1.5 rounded hover:bg-zinc-100 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedTreeIds.has(tree.id)}
                          onCheckedChange={() => toggleTreeSelection(tree.id)}
                        />
                        <MessagesSquare className="w-3 h-3 text-emerald-500" />
                        <span className="text-sm truncate">{tree.name}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Chat Area */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-4 space-y-4">
            {/* Loading indicator */}
            {loadingTurns && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
              </div>
            )}

            {/* Turns */}
            {turns.map((turn) => (
              <div key={turn.folderId} className="space-y-3">
                {/* Question */}
                <div className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center">
                    <User className="w-4 h-4 text-zinc-600" />
                  </div>
                  <div className="flex-1 bg-zinc-100 rounded-lg p-3">
                    <div className="text-sm whitespace-pre-wrap">{turn.question}</div>
                  </div>
                </div>

                {/* References - ABOVE the answer, like during streaming */}
                {turn.references.length > 0 && (
                  <div className="space-y-2 ml-11">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                      <FileText className="w-4 h-4" />
                      Sources ({turn.references.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {turn.references.map((ref, i) => {
                        const hydrated = hydratedRefs.get(ref.nodeId);
                        const title = hydrated?.title || "Loading...";
                        const gist = hydrated?.gist || "";

                        return (
                          <div
                            key={i}
                            className="relative bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs cursor-pointer hover:bg-emerald-100 hover:border-emerald-300 transition-colors"
                            onMouseEnter={() => setHoveredRef({ turnId: turn.folderId, refIndex: i })}
                            onMouseLeave={() => setHoveredRef(null)}
                            onClick={() => {
                              setPopupSource(null);
                              setPopupNodeId(ref.nodeId);
                              setPopupIndex(i + 1);
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-emerald-700">[{i + 1}]</span>
                              <span className="font-medium text-emerald-800 max-w-[200px] truncate">
                                {title}
                              </span>
                            </div>
                            {/* Hover Tooltip - show GIST */}
                            {hoveredRef?.turnId === turn.folderId && hoveredRef?.refIndex === i && gist && (
                              <div className="absolute z-50 top-full left-0 mt-2 w-72 p-3 bg-zinc-900 text-white text-xs rounded-lg shadow-xl pointer-events-none animate-in fade-in zoom-in-95 duration-150">
                                <div className="absolute top-0 left-4 transform -translate-y-1/2 rotate-45 w-2 h-2 bg-zinc-900"></div>
                                <div className="font-semibold text-emerald-300 mb-1">Summary:</div>
                                <div className="text-zinc-200 leading-relaxed">{gist}</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Answer */}
                <div className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="flex-1">
                    <div className="bg-purple-50 rounded-lg p-3">
                      <div className="text-sm whitespace-pre-wrap">{turn.answer}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Streaming Response */}
            {isStreaming && (
              <div className="space-y-3">
                {/* The question being asked */}
                {streamingQuestion && (
                  <div className="flex gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center">
                      <User className="w-4 h-4 text-zinc-600" />
                    </div>
                    <div className="flex-1 bg-zinc-100 rounded-lg p-3">
                      <div className="text-sm whitespace-pre-wrap">{streamingQuestion}</div>
                    </div>
                  </div>
                )}

                {/* Sources being discovered - with hover tooltips and click to view */}
                {streamingSources.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                      <FileText className="w-4 h-4" />
                      Sources Found ({streamingSources.length})
                      {!streamingAnswer && (
                        <Loader2 className="w-3 h-3 animate-spin text-emerald-500" />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {streamingSources.map((source, i) => (
                        <div
                          key={i}
                          className="relative bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs animate-in fade-in slide-in-from-left-2 duration-300 cursor-pointer hover:bg-emerald-100 hover:border-emerald-300 transition-colors"
                          onMouseEnter={() => setHoveredSource(source)}
                          onMouseLeave={() => setHoveredSource(null)}
                          onClick={() => {
                            setPopupSource(source);
                            setPopupNodeId(null);
                            setPopupIndex(source.index);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-emerald-700">[{source.index}]</span>
                            <span className="font-medium text-emerald-800 max-w-[200px] truncate">
                              {source.title}
                            </span>
                          </div>
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

                {/* Streaming answer */}
                <div className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="flex-1 bg-purple-50 rounded-lg p-3">
                    {streamingAnswer ? (
                      <div className="text-sm whitespace-pre-wrap">
                        {streamingAnswer}
                        <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-0.5" />
                      </div>
                    ) : streamingSources.length > 0 ? (
                      <div className="flex items-center gap-2 text-sm text-purple-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating answer from {streamingSources.length} sources...
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-purple-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Searching knowledge base...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Empty state */}
            {!loadingTurns && turns.length === 0 && !isStreaming && (
              <div className="text-center py-12 text-zinc-400">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="font-medium">Start a conversation</p>
                <p className="text-sm mt-1">
                  {selectedTreeIds.size === 0
                    ? "Select at least one tree above to search"
                    : `Ask a question about your selected ${selectedTreeIds.size} source${selectedTreeIds.size > 1 ? "s" : ""}`}
                </p>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="shrink-0 px-6 py-4 border-t bg-zinc-50">
          <div className="flex gap-2">
            <Input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={selectedTreeIds.size === 0 ? "Select trees first..." : "Ask a question..."}
              disabled={isStreaming || selectedTreeIds.size === 0}
              className="flex-1 bg-white"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button
              onClick={handleSend}
              disabled={!inputText.trim() || isStreaming || selectedTreeIds.size === 0}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-zinc-400 mt-2">
            {currentSession
              ? "Continuing conversation"
              : "Your question will start a new conversation"}
          </p>
        </div>
      </DialogContent>

      {/* Shared Source Popup - for both streaming sources and persisted references */}
      <SourcePopup
        open={!!(popupSource || popupNodeId)}
        onOpenChange={(open) => {
          if (!open) {
            setPopupSource(null);
            setPopupNodeId(null);
            setPopupIndex(undefined);
          }
        }}
        source={popupSource}
        nodeId={popupNodeId}
        index={popupIndex}
      />
    </Dialog>
  );
}
