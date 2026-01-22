import { useState, useCallback, useRef, useEffect } from "react";
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
  Upload,
  FileText,
  Scissors,
  FolderTree,
  CheckCircle,
  Loader2,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  GripVertical,
  Folder,
  Download,
  AlertCircle,
  Hash,
  Minus,
  SplitSquareVertical,
  ChevronsUp,
  ChevronsDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// ============ TYPES ============

interface DetectedSplit {
  title: string;
  text: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
}

interface SplitAnalysis {
  sourceUri: string;
  fullText: string;
  suggestedTitle: string;
  detectedSplits: DetectedSplit[];
  splitMethod: string;
}

interface LeafFolder {
  id: string;
  title: string;
  gist: string;
  path: string;
}

interface AuditEntry {
  timestamp: string;
  action: string;
  details: string;
  actor: "system" | "ai" | "human";
}

type WizardStep = "upload" | "splits" | "placement" | "confirm";

// ============ COMPONENT ============

interface IngestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  treeId: string;
  treeName: string;
  onComplete?: () => void;
}

export function IngestionDialog({
  open,
  onOpenChange,
  treeId,
  treeName,
  onComplete,
}: IngestionDialogProps) {
  // Wizard State
  const [step, setStep] = useState<WizardStep>("upload");

  // Upload State
  const [fileContent, setFileContent] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Split State
  const [analysis, setAnalysis] = useState<SplitAnalysis | null>(null);
  const [splits, setSplits] = useState<{ title: string; text: string }[]>([]);
  const [documentTitle, setDocumentTitle] = useState("");
  const [aiSplitLoading, setAiSplitLoading] = useState(false);

  // Placement State
  const [leafFolders, setLeafFolders] = useState<LeafFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [proposedPlacement, setProposedPlacement] = useState<{
    folderId: string;
    reasoning: string;
    confidence: number;
  } | null>(null);
  const [placementLoading, setPlacementLoading] = useState(false);
  const [documentGist, setDocumentGist] = useState("");
  const [gistLoading, setGistLoading] = useState(false);

  // Commit State
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [committedNodeId, setCommittedNodeId] = useState<string>("");

  // Audit Log
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const auditLogRef = useRef<HTMLDivElement>(null);

  // Auto-scroll audit log when new entries are added
  useEffect(() => {
    if (auditLogRef.current) {
      auditLogRef.current.scrollTop = auditLogRef.current.scrollHeight;
    }
  }, [auditLog]);

  // ============ HELPERS ============

  const addAuditEntry = (
    action: string,
    details: string,
    actor: AuditEntry["actor"]
  ) => {
    setAuditLog((prev) => [
      ...prev,
      { timestamp: new Date().toISOString(), action, details, actor },
    ]);
  };

  const resetWizard = () => {
    setStep("upload");
    setFileContent("");
    setAnalysis(null);
    setSplits([]);
    setDocumentTitle("");
    setLeafFolders([]);
    setSelectedFolderId("");
    setProposedPlacement(null);
    setDocumentGist("");
    setCommitted(false);
    setCommittedNodeId("");
    setAuditLog([]);
  };

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setTimeout(resetWizard, 300);
    }
  }, [open]);

  // ============ UPLOAD STEP ============

  const handleFileDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        await processFile(droppedFile);
      }
    },
    [treeId]
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      await processFile(selectedFile);
    }
  };

  const processFile = async (selectedFile: File) => {
    setUploading(true);
    addAuditEntry("FILE_SELECTED", `File: ${selectedFile.name}`, "human");

    try {
      // Read file content
      const text = await selectedFile.text();
      setFileContent(text);

      // Analyze for splits
      const res = await axios.post("/api/analyze", {
        content: text,
        sourceUri: selectedFile.name,
      });

      const analysisResult: SplitAnalysis = res.data;
      setAnalysis(analysisResult);
      setDocumentTitle(analysisResult.suggestedTitle);

      // Initialize splits from analysis
      if (analysisResult.detectedSplits.length > 0) {
        setSplits(
          analysisResult.detectedSplits.map((s) => ({
            title: s.title,
            text: s.text,
          }))
        );
        addAuditEntry(
          "SPLITS_DETECTED",
          `Method: ${analysisResult.splitMethod}, Count: ${analysisResult.detectedSplits.length}`,
          "system"
        );
      } else {
        // No splits detected - treat as single document
        setSplits([{ title: analysisResult.suggestedTitle, text: text }]);
        addAuditEntry(
          "NO_SPLITS_DETECTED",
          "Document will be ingested as a single unit",
          "system"
        );
      }

      setStep("splits");
    } catch (err: any) {
      console.error("Failed to analyze file:", err);
      addAuditEntry(
        "ANALYSIS_ERROR",
        err.message || "Unknown error",
        "system"
      );
    } finally {
      setUploading(false);
    }
  };

  // ============ SPLITS STEP ============

  const handleAiSplits = async () => {
    if (!fileContent) return;

    setAiSplitLoading(true);
    addAuditEntry("AI_SPLITS_REQUESTED", "User requested AI-assisted splitting", "human");

    try {
      const res = await axios.post("/api/generate/splits", {
        content: fileContent,
        treeId,
      });

      const aiSplits = res.data.splits || [];
      setSplits(aiSplits);
      addAuditEntry(
        "AI_SPLITS_GENERATED",
        `AI proposed ${aiSplits.length} splits`,
        "ai"
      );
    } catch (err: any) {
      console.error("AI split failed:", err);
      addAuditEntry("AI_SPLITS_ERROR", err.message || "Failed", "ai");
    } finally {
      setAiSplitLoading(false);
    }
  };

  const updateSplitTitle = (index: number, newTitle: string) => {
    setSplits((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], title: newTitle };
      return updated;
    });
  };

  const updateSplitText = (index: number, newText: string) => {
    setSplits((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], text: newText };
      return updated;
    });
  };

  const removeSplit = (index: number) => {
    addAuditEntry("SPLIT_REMOVED", `Removed split at index ${index}`, "human");
    setSplits((prev) => prev.filter((_, i) => i !== index));
  };

  const mergeWithPrevious = (index: number) => {
    if (index === 0) return;
    addAuditEntry(
      "SPLITS_MERGED",
      `Merged section ${index + 1} with section ${index}`,
      "human"
    );
    setSplits((prev) => {
      const updated = [...prev];
      const current = updated[index];
      const previous = updated[index - 1];
      // Combine: keep previous title, merge texts
      updated[index - 1] = {
        title: previous.title,
        text: previous.text + "\n\n" + current.text,
      };
      // Remove current
      return updated.filter((_, i) => i !== index);
    });
  };

  const mergeWithNext = (index: number) => {
    if (index >= splits.length - 1) return;
    addAuditEntry(
      "SPLITS_MERGED",
      `Merged section ${index + 1} with section ${index + 2}`,
      "human"
    );
    setSplits((prev) => {
      const updated = [...prev];
      const current = updated[index];
      const next = updated[index + 1];
      // Combine: keep current title, merge texts
      updated[index] = {
        title: current.title,
        text: current.text + "\n\n" + next.text,
      };
      // Remove next
      return updated.filter((_, i) => i !== index + 1);
    });
  };

  const addSplit = () => {
    addAuditEntry("SPLIT_ADDED", "Added new empty split", "human");
    setSplits((prev) => [...prev, { title: "New Section", text: "" }]);
  };

  const mergeSplits = () => {
    if (splits.length <= 1) return;
    addAuditEntry(
      "SPLITS_MERGED",
      `Merged ${splits.length} splits into single document`,
      "human"
    );
    setSplits([{ title: documentTitle, text: fileContent }]);
  };

  // Programmatic re-split with specific method
  const resplitWithMethod = (method: "h1" | "h2" | "h3" | "hr" | "none") => {
    if (!fileContent) return;

    addAuditEntry(
      "RESPLIT_REQUESTED",
      `User requested re-split with method: ${method.toUpperCase()}`,
      "human"
    );

    let newSplits: { title: string; text: string }[] = [];

    if (method === "none") {
      newSplits = [{ title: documentTitle || "Full Document", text: fileContent }];
    } else if (method === "hr") {
      // Split by horizontal rules (---)
      const parts = fileContent.split(/^\s*---\s*$/m).filter(p => p.trim());
      newSplits = parts.map((text, i) => ({
        title: `Section ${i + 1}`,
        text: text.trim(),
      }));
    } else {
      // Split by headers (h1, h2, h3)
      const headerLevel = method === "h1" ? 1 : method === "h2" ? 2 : 3;
      const headerRegex = new RegExp(`^(${"#".repeat(headerLevel)}\\s+.+)$`, "gm");
      const matches = [...fileContent.matchAll(headerRegex)];

      if (matches.length === 0) {
        addAuditEntry(
          "RESPLIT_EMPTY",
          `No ${method.toUpperCase()} headers found in document`,
          "system"
        );
        return;
      }

      // Content before first header
      if (matches[0].index! > 0) {
        const preamble = fileContent.slice(0, matches[0].index).trim();
        if (preamble.length > 0) {
          newSplits.push({ title: "Introduction", text: preamble });
        }
      }

      // Each header section
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const title = match[1].replace(/^#+\s*/, "").trim();
        const startIndex = match.index!;
        const endIndex = matches[i + 1]?.index ?? fileContent.length;
        const text = fileContent.slice(startIndex, endIndex).trim();
        newSplits.push({ title, text });
      }
    }

    if (newSplits.length > 0) {
      setSplits(newSplits);
      addAuditEntry(
        "RESPLIT_COMPLETE",
        `Created ${newSplits.length} splits using ${method.toUpperCase()} method`,
        "system"
      );
    }
  };

  const proceedToPlacement = async () => {
    addAuditEntry(
      "SPLITS_CONFIRMED",
      `Final split count: ${splits.length}`,
      "human"
    );

    // Load leaf folders
    setPlacementLoading(true);
    try {
      const res = await axios.get(`/api/trees/${treeId}/folders`);
      setLeafFolders(res.data);

      // Generate gist for the document
      setGistLoading(true);
      try {
        const gistRes = await axios.post("/api/generate/gist", {
          content: fileContent.slice(0, 5000), // First 5k chars for gist
          treeId,
        });
        setDocumentGist(gistRes.data.gist);
        addAuditEntry("GIST_GENERATED", "AI generated document summary", "ai");
      } catch (err) {
        setDocumentGist("Document summary pending...");
      } finally {
        setGistLoading(false);
      }

      // Get AI placement suggestion
      try {
        const placementRes = await axios.post("/api/propose-placement", {
          treeId,
          documentTitle,
          documentGist: documentGist || fileContent.slice(0, 500),
        });
        setProposedPlacement(placementRes.data);
        setSelectedFolderId(placementRes.data.folderId);
        addAuditEntry(
          "PLACEMENT_PROPOSED",
          `AI suggests: ${placementRes.data.folderId} (confidence: ${Math.round(placementRes.data.confidence * 100)}%)`,
          "ai"
        );
      } catch (err) {
        // Default to first leaf folder
        if (res.data.length > 0) {
          setSelectedFolderId(res.data[0].id);
        }
      }

      setStep("placement");
    } catch (err: any) {
      console.error("Failed to load folders:", err);
    } finally {
      setPlacementLoading(false);
    }
  };

  // ============ PLACEMENT STEP ============

  const handleFolderChange = (folderId: string) => {
    const wasProposed = proposedPlacement?.folderId === selectedFolderId;
    setSelectedFolderId(folderId);

    if (wasProposed && folderId !== proposedPlacement?.folderId) {
      addAuditEntry(
        "PLACEMENT_CHANGED",
        `Human changed placement from "${proposedPlacement?.folderId}" to "${folderId}"`,
        "human"
      );
    }
  };

  const proceedToConfirm = () => {
    addAuditEntry(
      "PLACEMENT_CONFIRMED",
      `Target folder: ${selectedFolderId}`,
      "human"
    );
    setStep("confirm");
  };

  // ============ CONFIRM STEP ============

  const handleCommit = async () => {
    setCommitting(true);
    addAuditEntry("COMMIT_STARTED", "Beginning ingestion process", "system");

    try {
      // Ingest the main document
      const docRes = await axios.post(`/api/trees/${treeId}/documents`, {
        folderId: selectedFolderId,
        content: fileContent,
        title: documentTitle,
        gist: documentGist,
      });

      const documentId = docRes.data.id;
      const contentId = docRes.data.contentId;
      setCommittedNodeId(documentId);

      addAuditEntry(
        "DOCUMENT_CREATED",
        `Document ID: ${documentId}, Content ID: ${contentId}`,
        "system"
      );

      // If there are multiple splits, create fragments
      if (splits.length > 1) {
        for (let i = 0; i < splits.length; i++) {
          const split = splits[i];
          const fragRes = await axios.post(`/api/trees/${treeId}/fragments`, {
            documentId,
            content: split.text,
            title: split.title,
          });
          addAuditEntry(
            "FRAGMENT_CREATED",
            `Fragment ${i + 1}: ${fragRes.data.id}`,
            "system"
          );
        }
      }

      addAuditEntry(
        "COMMIT_COMPLETE",
        `Successfully ingested document with ${splits.length} fragment(s)`,
        "system"
      );

      setCommitted(true);
      onComplete?.();
    } catch (err: any) {
      console.error("Commit failed:", err);
      addAuditEntry("COMMIT_ERROR", err.message || "Unknown error", "system");
    } finally {
      setCommitting(false);
    }
  };

  const downloadAuditLog = () => {
    const logContent = auditLog
      .map(
        (entry) =>
          `[${entry.timestamp}] [${entry.actor.toUpperCase()}] ${entry.action}: ${entry.details}`
      )
      .join("\n");

    const blob = new Blob([logContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ingestion-audit-${documentTitle.replace(/\s+/g, "-")}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ============ RENDER STEPS ============

  const renderStepIndicator = () => {
    const steps: { key: WizardStep; label: string; icon: React.ReactNode }[] = [
      { key: "upload", label: "Upload", icon: <Upload className="w-4 h-4" /> },
      { key: "splits", label: "Splits", icon: <Scissors className="w-4 h-4" /> },
      { key: "placement", label: "Place", icon: <FolderTree className="w-4 h-4" /> },
      { key: "confirm", label: "Confirm", icon: <CheckCircle className="w-4 h-4" /> },
    ];

    const currentIndex = steps.findIndex((s) => s.key === step);

    return (
      <div className="flex items-center justify-center gap-2 mb-6">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                i === currentIndex
                  ? "bg-purple-100 text-purple-700 border border-purple-200"
                  : i < currentIndex
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-zinc-100 text-zinc-400"
              }`}
            >
              {s.icon}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <ChevronRight className="w-4 h-4 text-zinc-300 mx-1" />
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderUploadStep = () => (
    <div className="space-y-6">
      <div
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
          dragOver
            ? "border-purple-400 bg-purple-50"
            : "border-zinc-200 hover:border-zinc-300"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleFileDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".txt,.md,.pdf,.json"
          onChange={handleFileSelect}
        />

        {uploading ? (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 mx-auto text-purple-500 animate-spin" />
            <p className="text-sm text-zinc-500">Analyzing file...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto bg-zinc-100 rounded-full flex items-center justify-center">
              <Upload className="w-8 h-8 text-zinc-400" />
            </div>
            <div>
              <p className="text-lg font-medium text-zinc-700">
                Drop a file here or click to browse
              </p>
              <p className="text-sm text-zinc-400 mt-1">
                Supports .txt, .md, .pdf, .json
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderSplitsStep = () => (
    <div className="flex flex-col h-full space-y-4">
      {/* Document Title */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Document Title
        </label>
        <Input
          value={documentTitle}
          onChange={(e) => setDocumentTitle(e.target.value)}
          placeholder="Enter document title..."
          className="text-lg font-medium"
        />
      </div>

      {/* Split Actions */}
      <div className="flex items-center justify-between py-3 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">
            {splits.length} section{splits.length !== 1 ? "s" : ""} detected
          </span>
          <span className="text-xs text-zinc-400">
            ({analysis?.splitMethod || "manual"})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Programmatic Split Options */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <SplitSquareVertical className="w-4 h-4" />
                Re-split
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => resplitWithMethod("h1")}>
                <Hash className="w-4 h-4 mr-2" />
                Split by H1 (#)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => resplitWithMethod("h2")}>
                <Hash className="w-4 h-4 mr-2" />
                Split by H2 (##)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => resplitWithMethod("h3")}>
                <Hash className="w-4 h-4 mr-2" />
                Split by H3 (###)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => resplitWithMethod("hr")}>
                <Minus className="w-4 h-4 mr-2" />
                Split by HR (---)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => resplitWithMethod("none")}>
                No Split (single doc)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* AI Split */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleAiSplits}
            disabled={aiSplitLoading}
          >
            {aiSplitLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            AI Split
          </Button>

          <Button variant="outline" size="sm" onClick={mergeSplits}>
            Merge All
          </Button>
          <Button variant="outline" size="sm" onClick={addSplit}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Splits List */}
      <ScrollArea className="flex-1 min-h-[300px] pr-4">
        <div className="space-y-3">
          {splits.map((split, index) => (
            <div
              key={index}
              className="border rounded-lg p-4 bg-white hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="pt-2 text-zinc-300 cursor-grab">
                  <GripVertical className="w-4 h-4" />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                      {index + 1}
                    </span>
                    <Input
                      value={split.title}
                      onChange={(e) => updateSplitTitle(index, e.target.value)}
                      placeholder="Section title..."
                      className="text-sm font-medium h-8"
                    />
                    {/* Merge with previous */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => mergeWithPrevious(index)}
                      disabled={index === 0}
                      className="text-zinc-400 hover:text-blue-500 disabled:opacity-30"
                      title="Merge with previous section"
                    >
                      <ChevronsUp className="w-4 h-4" />
                    </Button>
                    {/* Merge with next */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => mergeWithNext(index)}
                      disabled={index >= splits.length - 1}
                      className="text-zinc-400 hover:text-blue-500 disabled:opacity-30"
                      title="Merge with next section"
                    >
                      <ChevronsDown className="w-4 h-4" />
                    </Button>
                    {/* Delete */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeSplit(index)}
                      className="text-zinc-400 hover:text-red-500"
                      title="Delete section"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <textarea
                    value={split.text}
                    onChange={(e) => updateSplitText(index, e.target.value)}
                    className="w-full text-xs font-mono bg-zinc-50 border rounded p-2 resize-none h-24"
                    placeholder="Section content..."
                  />
                  <div className="text-xs text-zinc-400">
                    {split.text.length} characters
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={() => setStep("upload")}>
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>
        <Button onClick={proceedToPlacement} disabled={splits.length === 0}>
          Continue to Placement
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  const renderPlacementStep = () => (
    <div className="space-y-4">
      {placementLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        </div>
      ) : (
        <>
          {/* Document Summary */}
          <div className="bg-zinc-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              <span className="font-semibold">{documentTitle}</span>
            </div>
            <div className="text-sm text-zinc-600">
              {gistLoading ? (
                <span className="text-zinc-400 italic">Generating summary...</span>
              ) : (
                documentGist
              )}
            </div>
            <div className="text-xs text-zinc-400">
              {splits.length} section{splits.length !== 1 ? "s" : ""} |{" "}
              {fileContent.length.toLocaleString()} characters
            </div>
          </div>

          {/* AI Suggestion */}
          {proposedPlacement && (
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-4">
              <div className="flex items-center gap-2 text-purple-700 text-sm font-medium mb-2">
                <Sparkles className="w-4 h-4" />
                AI Recommendation
              </div>
              <p className="text-sm text-purple-600">{proposedPlacement.reasoning}</p>
              <div className="text-xs text-purple-400 mt-1">
                Confidence: {Math.round(proposedPlacement.confidence * 100)}%
              </div>
            </div>
          )}

          {/* Folder Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Select Target Folder
            </label>
            <ScrollArea className="h-[300px] border rounded-lg">
              <div className="p-2 space-y-1">
                {leafFolders.map((folder) => (
                  <div
                    key={folder.id}
                    onClick={() => handleFolderChange(folder.id)}
                    className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedFolderId === folder.id
                        ? "bg-purple-50 border border-purple-200"
                        : "hover:bg-zinc-50"
                    }`}
                  >
                    <Folder
                      className={`w-5 h-5 mt-0.5 ${
                        selectedFolderId === folder.id
                          ? "text-purple-600"
                          : "text-blue-500"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {folder.title}
                        {proposedPlacement?.folderId === folder.id && (
                          <span className="ml-2 text-xs text-purple-500">
                            (AI suggested)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-400 truncate">
                        {folder.gist}
                      </div>
                      <div className="text-[10px] text-zinc-300 font-mono mt-1">
                        {folder.path}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Navigation */}
          <div className="flex justify-between pt-4 border-t">
            <Button variant="outline" onClick={() => setStep("splits")}>
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>
            <Button onClick={proceedToConfirm} disabled={!selectedFolderId}>
              Review & Confirm
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );

  const renderConfirmStep = () => (
    <div className="space-y-4">
      {committed ? (
        <div className="text-center py-8 space-y-4">
          <div className="w-16 h-16 mx-auto bg-emerald-100 rounded-full flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">
              Successfully Ingested!
            </h3>
            <p className="text-sm text-zinc-500 mt-1">
              Document ID: <code className="bg-zinc-100 px-2 py-0.5 rounded text-xs">{committedNodeId}</code>
            </p>
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={downloadAuditLog}>
              <Download className="w-4 h-4" />
              Download Audit Log
            </Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="bg-zinc-50 rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-zinc-900">Ingestion Summary</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-zinc-400">Document:</span>
                <p className="font-medium truncate">{documentTitle}</p>
              </div>
              <div>
                <span className="text-zinc-400">Target Tree:</span>
                <p className="font-medium">{treeName}</p>
              </div>
              <div>
                <span className="text-zinc-400">Target Folder:</span>
                <p className="font-medium truncate">
                  {leafFolders.find((f) => f.id === selectedFolderId)?.title}
                </p>
              </div>
              <div>
                <span className="text-zinc-400">Fragments:</span>
                <p className="font-medium">{splits.length}</p>
              </div>
            </div>
          </div>

          {/* Audit Log Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Audit Trail ({auditLog.length} entries)
              </label>
              <Button variant="ghost" size="sm" onClick={downloadAuditLog}>
                <Download className="w-3 h-3" />
              </Button>
            </div>
            <div
              ref={auditLogRef}
              className="h-[200px] border rounded-lg bg-zinc-900 p-3 overflow-y-auto"
            >
              <div className="space-y-1 font-mono text-xs">
                {auditLog.map((entry, i) => (
                  <div
                    key={i}
                    className={`${
                      entry.actor === "ai"
                        ? "text-purple-400"
                        : entry.actor === "human"
                          ? "text-emerald-400"
                          : "text-zinc-400"
                    }`}
                  >
                    <span className="text-zinc-600">
                      [{new Date(entry.timestamp).toLocaleTimeString()}]
                    </span>{" "}
                    <span className="text-zinc-500">[{entry.actor.toUpperCase()}]</span>{" "}
                    <span className="text-white">{entry.action}:</span>{" "}
                    {entry.details}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-lg p-4">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
            <div className="text-sm text-amber-700">
              This will create a new document node and {splits.length > 1 ? `${splits.length} fragment nodes` : "store the content"} in the tree. This action cannot be undone.
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-between pt-4 border-t">
            <Button variant="outline" onClick={() => setStep("placement")}>
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>
            <Button onClick={handleCommit} disabled={committing}>
              {committing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Ingesting...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Commit Ingestion
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );

  // ============ MAIN RENDER ============

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-6xl h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-purple-600" />
            Ingest Document into {treeName}
          </DialogTitle>
          <DialogDescription>
            Human-assisted document ingestion with split detection and placement control.
          </DialogDescription>
        </DialogHeader>

        {renderStepIndicator()}

        <div className="flex-1 overflow-auto">
          {step === "upload" && renderUploadStep()}
          {step === "splits" && renderSplitsStep()}
          {step === "placement" && renderPlacementStep()}
          {step === "confirm" && renderConfirmStep()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
