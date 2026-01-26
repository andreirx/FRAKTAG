import { useState, useRef, useEffect } from "react";
import axios from "axios";
import {
  Dialog,
  DialogContent,
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
  Trash2,
  Plus,
  Database,
  MessagesSquare,
  ChevronDown,
  ChevronRight,
  Settings2,
} from "lucide-react";
import { SourcePopup, StreamingSourceData } from "./SourcePopup";
import { MarkdownRenderer } from "./MarkdownRenderer";

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
  const [showTreeSelector, setShowTreeSelector] = useState(false);

  // Session state
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ConversationSession | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);

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
    } else {
      setTurns([]);
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

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
    setHydratedRefs(new Map());
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

        // Auto-include conversation tree after first turn so AI can reference conversation history
        const conversationTreeId = `conversations-${kbId}`;
        if (trees.some(t => t.id === conversationTreeId)) {
          setSelectedTreeIds(prev => {
            if (prev.has(conversationTreeId)) return prev;
            const next = new Set(prev);
            next.add(conversationTreeId);
            return next;
          });
        }
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

  // Get names of selected trees for display
  const selectedTreeNames = trees
    .filter(t => selectedTreeIds.has(t.id))
    .map(t => t.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-6xl h-[90vh] p-0 gap-0 flex">
        {/* Sidebar */}
        <div className="w-64 shrink-0 bg-zinc-200 text-black flex flex-col">
          {/* New Chat Button */}
          <div className="p-3 border-b border-zinc-700">
            <Button
              onClick={startNewConversation}
              className="w-full bg-zinc-700 hover:bg-zinc-600 text-white border border-zinc-600 gap-2"
            >
              <Plus className="w-4 h-4" />
              New Chat
            </Button>
          </div>

          {/* Conversations List */}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {loadingSessions ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-4">
                  No conversations yet
                </p>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => setCurrentSession(session)}
                    className={`group flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      currentSession?.id === session.id
                        ? "bg-zinc-400"
                        : "hover:bg-zinc-300"
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 shrink-0 text-zinc-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{session.title}</div>
                      <div className="text-xs text-zinc-500">
                        {session.turnCount} turn{session.turnCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <button
                      onClick={(e) => deleteSession(session.id, e)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-600 rounded transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-zinc-400 hover:text-red-400" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {/* KB Info */}
          <div className="p-3 border-t border-zinc-700 text-xs text-zinc-500">
            <div className="truncate">{kbName || "Internal Knowledge Base"}</div>
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Tree Selection Header - Always Visible */}
          <div className="shrink-0 border-b bg-zinc-50 px-4 py-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowTreeSelector(!showTreeSelector)}
                className="flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900"
              >
                <Settings2 className="w-4 h-4" />
                <span className="font-medium">Sources:</span>
                {showTreeSelector ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>

              {/* Selected Trees Display */}
              <div className="flex-1 flex items-center gap-1.5 overflow-x-auto">
                {selectedTreeIds.size === 0 ? (
                  <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                    No sources selected
                  </span>
                ) : (
                  selectedTreeNames.map((name, i) => (
                    <span
                      key={i}
                      className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full whitespace-nowrap"
                    >
                      {name}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Expanded Tree Selector */}
            {showTreeSelector && (
              <div className="mt-3 p-3 bg-white rounded-lg border shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    Select Knowledge Sources
                  </span>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setSelectedTreeIds(new Set(trees.map(t => t.id)))}
                      className="text-xs text-purple-600 hover:text-purple-800"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setSelectedTreeIds(new Set())}
                      className="text-xs text-zinc-500 hover:text-zinc-700"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {/* Knowledge Trees */}
                  {knowledgeTrees.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                        Knowledge Trees
                      </div>
                      {knowledgeTrees.map((tree) => (
                        <label
                          key={tree.id}
                          className="flex items-center gap-2 p-1.5 rounded hover:bg-zinc-50 cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedTreeIds.has(tree.id)}
                            onCheckedChange={() => toggleTreeSelection(tree.id)}
                          />
                          <Database className="w-3.5 h-3.5 text-purple-500" />
                          <span className="text-sm truncate">{tree.name}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Conversation Trees */}
                  {conversationTrees.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                        Conversation History
                      </div>
                      {conversationTrees.map((tree) => (
                        <label
                          key={tree.id}
                          className="flex items-center gap-2 p-1.5 rounded hover:bg-zinc-50 cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedTreeIds.has(tree.id)}
                            onCheckedChange={() => toggleTreeSelection(tree.id)}
                          />
                          <MessagesSquare className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-sm truncate">{tree.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Chat Messages Area */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {/* Loading indicator */}
              {loadingTurns && (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                </div>
              )}

              {/* Turns */}
              {turns.map((turn) => (
                <div key={turn.folderId} className="space-y-4">
                  {/* Question */}
                  <div className="flex gap-4">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center">
                      <User className="w-4 h-4 text-zinc-600" />
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="text-sm whitespace-pre-wrap">{turn.question}</div>
                    </div>
                  </div>

                  {/* Answer with Sources */}
                  <div className="flex gap-4">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-purple-600" />
                    </div>
                    <div className="flex-1 space-y-3">
                      {/* Sources - compact inline display */}
                      {turn.references.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {turn.references.map((ref, i) => {
                            const hydrated = hydratedRefs.get(ref.nodeId);
                            const title = hydrated?.title || "Loading...";
                            const gist = hydrated?.gist || "";

                            return (
                              <div
                                key={i}
                                className="relative bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-xs cursor-pointer hover:bg-emerald-100 hover:border-emerald-300 transition-colors"
                                onMouseEnter={() => setHoveredRef({ turnId: turn.folderId, refIndex: i })}
                                onMouseLeave={() => setHoveredRef(null)}
                                onClick={() => {
                                  setPopupSource(null);
                                  setPopupNodeId(ref.nodeId);
                                  setPopupIndex(i + 1);
                                }}
                              >
                                <span className="font-semibold text-emerald-700">[{i + 1}]</span>
                                <span className="ml-1 text-emerald-800 max-w-[150px] truncate inline-block align-bottom">
                                  {title}
                                </span>
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
                      )}

                      {/* Answer */}
                      <div className="text-sm leading-relaxed">
                        <MarkdownRenderer content={turn.answer} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Streaming Response */}
              {isStreaming && (
                <div className="space-y-4">
                  {/* The question being asked */}
                  {streamingQuestion && (
                    <div className="flex gap-4">
                      <div className="shrink-0 w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center">
                        <User className="w-4 h-4 text-zinc-600" />
                      </div>
                      <div className="flex-1 pt-1">
                        <div className="text-sm whitespace-pre-wrap">{streamingQuestion}</div>
                      </div>
                    </div>
                  )}

                  {/* Answer being generated */}
                  <div className="flex gap-4">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-purple-600" />
                    </div>
                    <div className="flex-1 space-y-3">
                      {/* Sources being discovered */}
                      {streamingSources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {streamingSources.map((source, i) => (
                            <div
                              key={i}
                              className="relative bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-xs animate-in fade-in slide-in-from-left-2 duration-300 cursor-pointer hover:bg-emerald-100 hover:border-emerald-300 transition-colors"
                              onMouseEnter={() => setHoveredSource(source)}
                              onMouseLeave={() => setHoveredSource(null)}
                              onClick={() => {
                                setPopupSource(source);
                                setPopupNodeId(null);
                                setPopupIndex(source.index);
                              }}
                            >
                              <span className="font-semibold text-emerald-700">[{source.index}]</span>
                              <span className="ml-1 text-emerald-800 max-w-[150px] truncate inline-block align-bottom">
                                {source.title}
                              </span>
                              {/* Hover Tooltip showing gist */}
                              {hoveredSource === source && source.gist && (
                                <div className="absolute z-50 top-full left-0 mt-2 w-72 p-3 bg-zinc-900 text-white text-xs rounded-lg shadow-xl pointer-events-none animate-in fade-in zoom-in-95 duration-150">
                                  <div className="absolute top-0 left-4 transform -translate-y-1/2 rotate-45 w-2 h-2 bg-zinc-900"></div>
                                  <div className="font-semibold text-emerald-300 mb-1">Summary:</div>
                                  <div className="text-zinc-200 leading-relaxed">{source.gist}</div>
                                </div>
                              )}
                            </div>
                          ))}
                          {!streamingAnswer && (
                            <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                          )}
                        </div>
                      )}

                      {/* Streaming answer */}
                      {streamingAnswer ? (
                        <div className="text-sm leading-relaxed">
                          <MarkdownRenderer content={streamingAnswer} />
                          <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-0.5" />
                        </div>
                      ) : streamingSources.length > 0 ? (
                        <div className="flex items-center gap-2 text-sm text-zinc-500">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generating answer...
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-zinc-500">
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
                <div className="text-center py-16 text-zinc-400">
                  <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <p className="text-lg font-medium text-zinc-600">
                    {currentSession ? "No messages yet" : "Start a new conversation"}
                  </p>
                  <p className="text-sm mt-2">
                    {selectedTreeIds.size === 0
                      ? "Select knowledge sources above, then ask a question"
                      : `Ask a question about your ${selectedTreeIds.size} selected source${selectedTreeIds.size > 1 ? "s" : ""}`}
                  </p>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="shrink-0 border-t bg-white px-4 py-4">
            <div className="max-w-3xl mx-auto">
              <div className="flex gap-3">
                <Input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={selectedTreeIds.size === 0 ? "Select sources first..." : "Message..."}
                  disabled={isStreaming || selectedTreeIds.size === 0}
                  className="flex-1"
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
                  className="bg-purple-600 hover:bg-purple-700 px-4"
                >
                  {isStreaming ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
              {selectedTreeIds.size === 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  Click "Sources" above to select which knowledge trees to search
                </p>
              )}
            </div>
          </div>
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
