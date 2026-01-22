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
  const [sectionSplitLoading, setSectionSplitLoading] = useState<number | null>(null);

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

  // Loading state for transition to placement (AI calls happen here)
  const [transitioningToPlacement, setTransitioningToPlacement] = useState(false);

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
    setTransitioningToPlacement(false);
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
    addAuditEntry("FILE_SELECTED", `File: ${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`, "human");

    try {
      let text: string;

      // Check if file needs binary parsing (PDF, etc.)
      const needsBinaryParsing = selectedFile.name.toLowerCase().endsWith('.pdf');

      if (needsBinaryParsing) {
        addAuditEntry("PARSING_BINARY", `Parsing binary file: ${selectedFile.name}`, "system");

        // Read as ArrayBuffer and convert to base64
        const arrayBuffer = await selectedFile.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        // Send to parse endpoint
        const parseRes = await axios.post("/api/parse", {
          fileName: selectedFile.name,
          content: base64,
        });

        text = parseRes.data.text;
        addAuditEntry(
          "PARSING_COMPLETE",
          `Extracted ${parseRes.data.textLength.toLocaleString()} characters from ${selectedFile.name}`,
          "system"
        );
      } else {
        // Read as text directly
        text = await selectedFile.text();
      }

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

  // Helper: Extract real title from content when header is a repeated delimiter
  // e.g., "## Point\nAdversity as the Ultimate Attitude Test" -> "Adversity as the Ultimate Attitude Test"
  const extractRealTitle = (text: string, headerTitle: string): string => {
    // Remove the header line itself from text
    const lines = text.split("\n");
    const headerLineIndex = lines.findIndex(l => l.trim().endsWith(headerTitle) || l.includes(`# ${headerTitle}`));

    // Look at lines after the header for the real title
    for (let i = headerLineIndex + 1; i < lines.length && i < headerLineIndex + 5; i++) {
      const line = lines[i].trim();
      // Skip empty lines and common section markers
      if (!line || line.startsWith("#") || line === "---") continue;
      // Found a non-empty content line - use it as title (truncate if too long)
      if (line.length > 5 && line.length < 150) {
        return line;
      }
      break;
    }
    return headerTitle;
  };

  // Helper: Post-process splits to detect and fix repeated delimiter titles
  const smartifyTitles = (rawSplits: { title: string; text: string }[]): { title: string; text: string; wasSmartified?: boolean }[] => {
    if (rawSplits.length < 2) return rawSplits;

    // Count title occurrences
    const titleCounts: Record<string, number> = {};
    rawSplits.forEach(s => {
      const t = s.title.toLowerCase();
      titleCounts[t] = (titleCounts[t] || 0) + 1;
    });

    // Find titles that appear in more than 30% of sections (likely delimiters)
    const repeatedTitles = Object.entries(titleCounts)
      .filter(([_, count]) => count >= Math.max(2, rawSplits.length * 0.3))
      .map(([title]) => title);

    if (repeatedTitles.length === 0) return rawSplits;

    // Replace repeated delimiter titles with actual content titles
    let smartifiedCount = 0;
    const result = rawSplits.map(split => {
      if (repeatedTitles.includes(split.title.toLowerCase())) {
        const realTitle = extractRealTitle(split.text, split.title);
        if (realTitle !== split.title) {
          smartifiedCount++;
          return { ...split, title: realTitle, wasSmartified: true };
        }
      }
      return split;
    });

    if (smartifiedCount > 0) {
      addAuditEntry(
        "SMART_TITLES_DETECTED",
        `Auto-extracted ${smartifiedCount} real titles from repeated delimiter headers (e.g., "${repeatedTitles[0]}")`,
        "system"
      );
    }

    return result;
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
      // For HR splits, try to extract title from first non-empty line
      newSplits = parts.map((text, i) => {
        const lines = text.trim().split("\n");
        // Find first substantive line for title
        let title = `Section ${i + 1}`;
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip headers and empty lines
          if (!trimmed || trimmed.startsWith("#")) continue;
          if (trimmed.length > 5 && trimmed.length < 150) {
            title = trimmed;
            break;
          }
        }
        return { title, text: text.trim() };
      });
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

      // Smart title detection: if many titles are the same, they're probably delimiters
      newSplits = smartifyTitles(newSplits);
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

  // Split a SINGLE section with specific method (nested splitting)
  const splitSingleSection = (index: number, method: "h2" | "h3" | "hr") => {
    const section = splits[index];
    if (!section) return;

    addAuditEntry(
      "SECTION_SPLIT_REQUESTED",
      `User requested to split section ${index + 1} ("${section.title}") with method: ${method.toUpperCase()}`,
      "human"
    );

    let subSplits: { title: string; text: string }[] = [];

    if (method === "hr") {
      // Split by horizontal rules (---)
      const parts = section.text.split(/^\s*---\s*$/m).filter(p => p.trim());
      if (parts.length <= 1) {
        addAuditEntry(
          "SECTION_SPLIT_EMPTY",
          `No HR separators found in section ${index + 1}`,
          "system"
        );
        return;
      }
      // For HR splits, try to extract title from first substantive line
      subSplits = parts.map((text, i) => {
        const lines = text.trim().split("\n");
        let title = `${section.title} - Part ${i + 1}`;
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip headers and empty lines
          if (!trimmed || trimmed.startsWith("#")) continue;
          if (trimmed.length > 5 && trimmed.length < 150) {
            title = trimmed;
            break;
          }
        }
        return { title, text: text.trim() };
      });
    } else {
      // Split by headers (h2, h3)
      const headerLevel = method === "h2" ? 2 : 3;
      const headerRegex = new RegExp(`^(${"#".repeat(headerLevel)}\\s+.+)$`, "gm");
      const matches = [...section.text.matchAll(headerRegex)];

      if (matches.length === 0) {
        addAuditEntry(
          "SECTION_SPLIT_EMPTY",
          `No ${method.toUpperCase()} headers found in section ${index + 1}`,
          "system"
        );
        return;
      }

      // Content before first header
      if (matches[0].index! > 0) {
        const preamble = section.text.slice(0, matches[0].index).trim();
        if (preamble.length > 0) {
          subSplits.push({ title: `${section.title} - Introduction`, text: preamble });
        }
      }

      // Each header section
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const title = match[1].replace(/^#+\s*/, "").trim();
        const startIndex = match.index!;
        const endIndex = matches[i + 1]?.index ?? section.text.length;
        const text = section.text.slice(startIndex, endIndex).trim();
        subSplits.push({ title, text });
      }

      // Apply smart title detection
      subSplits = smartifyTitles(subSplits);
    }

    if (subSplits.length > 1) {
      // Replace the single section with its sub-sections
      setSplits((prev) => {
        const updated = [...prev];
        updated.splice(index, 1, ...subSplits);
        return updated;
      });
      addAuditEntry(
        "SECTION_SPLIT_COMPLETE",
        `Split section ${index + 1} into ${subSplits.length} sub-sections using ${method.toUpperCase()}`,
        "system"
      );
    }
  };

  // AI split a SINGLE section
  const aiSplitSingleSection = async (index: number) => {
    const section = splits[index];
    if (!section) return;

    setSectionSplitLoading(index);
    addAuditEntry(
      "SECTION_AI_SPLIT_REQUESTED",
      `User requested AI-assisted split for section ${index + 1} ("${section.title}")`,
      "human"
    );

    try {
      const res = await axios.post("/api/generate/splits", {
        content: section.text,
        treeId,
      });

      const aiSplits = res.data.splits || [];

      if (aiSplits.length > 1) {
        // Replace the single section with AI-generated sub-sections
        setSplits((prev) => {
          const updated = [...prev];
          updated.splice(index, 1, ...aiSplits);
          return updated;
        });
        addAuditEntry(
          "SECTION_AI_SPLIT_COMPLETE",
          `AI split section ${index + 1} into ${aiSplits.length} sub-sections`,
          "ai"
        );
      } else {
        addAuditEntry(
          "SECTION_AI_SPLIT_SINGLE",
          `AI determined section ${index + 1} should remain as a single unit`,
          "ai"
        );
      }
    } catch (err: any) {
      console.error("AI section split failed:", err);
      addAuditEntry("SECTION_AI_SPLIT_ERROR", err.message || "Failed", "ai");
    } finally {
      setSectionSplitLoading(null);
    }
  };

  const proceedToPlacement = async () => {
    addAuditEntry(
      "SPLITS_CONFIRMED",
      `Final split count: ${splits.length}`,
      "human"
    );

    // Show loading indicator on the button while AI is working
    setTransitioningToPlacement(true);

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
      setTransitioningToPlacement(false);
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

      // Auto-save audit log to tree
      const finalAuditLog = [
        ...auditLog,
        {
          timestamp: new Date().toISOString(),
          action: "COMMIT_COMPLETE",
          details: `Successfully ingested document with ${splits.length} fragment(s)`,
          actor: "system" as const,
        },
      ];

      try {
        await axios.post(`/api/trees/${treeId}/audit-log`, {
          entries: finalAuditLog,
          sessionId: `ingestion-${Date.now()}`,
        });
        addAuditEntry("AUDIT_SAVED", "Audit log persisted to tree", "system");
      } catch (auditErr) {
        console.error("Failed to save audit log:", auditErr);
      }

      setCommitted(true);
      onComplete?.();
    } catch (err: any) {
      console.error("Commit failed:", err);
      addAuditEntry("COMMIT_ERROR", err.message || "Unknown error", "system");

      // Save audit log even on error
      try {
        await axios.post(`/api/trees/${treeId}/audit-log`, {
          entries: [
            ...auditLog,
            {
              timestamp: new Date().toISOString(),
              action: "COMMIT_ERROR",
              details: err.message || "Unknown error",
              actor: "system" as const,
            },
          ],
          sessionId: `ingestion-${Date.now()}`,
        });
      } catch (auditErr) {
        console.error("Failed to save audit log:", auditErr);
      }
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

  // ============ RENDER HELPERS ============

  // Generate a color for each split based on index
  const getSplitColor = (index: number) => {
    const colors = [
      "bg-purple-400",
      "bg-blue-400",
      "bg-emerald-400",
      "bg-amber-400",
      "bg-rose-400",
      "bg-cyan-400",
      "bg-indigo-400",
      "bg-orange-400",
      "bg-teal-400",
      "bg-pink-400",
    ];
    return colors[index % colors.length];
  };

  // Render the document minimap showing where splits fall
  const renderDocumentMinimap = () => {
    if (!fileContent || splits.length === 0) return null;

    const totalLength = fileContent.length;

    // Calculate positions for each split in the document
    // We need to find where each split's text appears in the original content
    const splitPositions: { startPercent: number; endPercent: number; title: string; charCount: number }[] = [];
    let searchStart = 0;

    for (const split of splits) {
      // Find where this split's text starts in the original document
      const startIdx = fileContent.indexOf(split.text.slice(0, 100), searchStart);
      const actualStart = startIdx >= 0 ? startIdx : searchStart;
      const endIdx = actualStart + split.text.length;

      splitPositions.push({
        startPercent: (actualStart / totalLength) * 100,
        endPercent: (endIdx / totalLength) * 100,
        title: split.title,
        charCount: split.text.length,
      });

      searchStart = endIdx;
    }

    return (
      <div className="w-16 shrink-0 flex flex-col gap-2">
        <div className="text-[10px] text-zinc-400 uppercase tracking-wider text-center font-medium">
          Map
        </div>
        {/* The minimap container */}
        <div className="relative flex-1 min-h-[200px] bg-zinc-100 rounded-lg overflow-hidden border border-zinc-200">
          {/* Tiny text preview background - simulating code minimap look */}
          <div className="absolute inset-0 opacity-20">
            {fileContent.slice(0, 5000).split('\n').slice(0, 100).map((line, i) => (
              <div
                key={i}
                className="h-[2px] bg-zinc-400 my-[1px] mx-1"
                style={{ width: `${Math.min(100, (line.length / 80) * 100)}%` }}
              />
            ))}
          </div>

          {/* Split regions overlay */}
          {splitPositions.map((pos, index) => (
            <div
              key={index}
              className={`absolute left-0 right-0 ${getSplitColor(index)} opacity-60 hover:opacity-90 transition-opacity cursor-pointer group`}
              style={{
                top: `${pos.startPercent}%`,
                height: `${Math.max(pos.endPercent - pos.startPercent, 1)}%`,
              }}
              title={`${pos.title} (${pos.charCount.toLocaleString()} chars)`}
            >
              {/* Split number badge */}
              <div className="absolute -left-0.5 top-0 w-4 h-4 rounded-full bg-white shadow-sm flex items-center justify-center text-[8px] font-bold text-zinc-600 border">
                {index + 1}
              </div>
            </div>
          ))}

          {/* Split boundary lines */}
          {splitPositions.map((pos, index) => (
            index > 0 && (
              <div
                key={`line-${index}`}
                className="absolute left-0 right-0 h-px bg-zinc-600"
                style={{ top: `${pos.startPercent}%` }}
              />
            )
          ))}
        </div>

        {/* Legend */}
        <div className="text-[9px] text-zinc-400 text-center">
          {splits.length} splits
        </div>
      </div>
    );
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

      {/* Main content area with minimap */}
      <div className="flex-1 flex gap-4 min-h-[300px]">
        {/* Document Minimap */}
        {renderDocumentMinimap()}

        {/* Splits List */}
        <ScrollArea className="flex-1 pr-4">
        <div className="space-y-3">
          {splits.map((split, index) => (
            <div
              key={index}
              className="border rounded-lg p-4 bg-white hover:shadow-sm transition-shadow relative overflow-hidden"
            >
              {/* Color bar matching minimap */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${getSplitColor(index)}`} />
              <div className="flex items-start gap-3 pl-2">
                <div className="pt-2 text-zinc-300 cursor-grab">
                  <GripVertical className="w-4 h-4" />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold text-white px-2 py-0.5 rounded ${getSplitColor(index)}`}>
                      {index + 1}
                    </span>
                    <Input
                      value={split.title}
                      onChange={(e) => updateSplitTitle(index, e.target.value)}
                      placeholder="Section title..."
                      className="text-sm font-medium h-8"
                    />
                    {/* Split this section further */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={sectionSplitLoading === index}
                          className="text-zinc-400 hover:text-purple-500"
                          title="Split this section"
                        >
                          {sectionSplitLoading === index ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Scissors className="w-4 h-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => splitSingleSection(index, "h2")}>
                          <Hash className="w-4 h-4 mr-2" />
                          Split by H2 (##)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => splitSingleSection(index, "h3")}>
                          <Hash className="w-4 h-4 mr-2" />
                          Split by H3 (###)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => splitSingleSection(index, "hr")}>
                          <Minus className="w-4 h-4 mr-2" />
                          Split by HR (---)
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => aiSplitSingleSection(index)}>
                          <Sparkles className="w-4 h-4 mr-2" />
                          AI Split
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span>{split.text.length.toLocaleString()} characters</span>
                    {split.text.length > 5000 && (
                      <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1">
                        <Scissors className="w-3 h-3" />
                        Large section - consider splitting
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={() => setStep("upload")}>
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>
        <Button
          onClick={proceedToPlacement}
          disabled={splits.length === 0 || transitioningToPlacement}
        >
          {transitioningToPlacement ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              AI analyzing placement...
            </>
          ) : (
            <>
              Continue to Placement
              <ChevronRight className="w-4 h-4" />
            </>
          )}
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
                {leafFolders.map((folder) => {
                  // Split path into parent path and folder name
                  const pathSegments = folder.path.split(" > ");
                  const folderName = folder.title; // Use actual title, not last path segment
                  const parentPath = pathSegments.slice(0, -1); // All except the last

                  return (
                    <div
                      key={folder.id}
                      onClick={() => handleFolderChange(folder.id)}
                      className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedFolderId === folder.id
                          ? "bg-purple-50 border border-purple-200"
                          : "hover:bg-zinc-50 border border-transparent"
                      }`}
                    >
                      <Folder
                        className={`w-5 h-5 mt-0.5 shrink-0 ${
                          selectedFolderId === folder.id
                            ? "text-purple-600"
                            : "text-blue-500"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        {/* Folder name shown prominently */}
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-zinc-900">{folderName}</span>
                          {proposedPlacement?.folderId === folder.id && (
                            <span className="text-[10px] text-purple-500 bg-purple-100 px-1.5 py-0.5 rounded-full font-medium">
                              AI suggested
                            </span>
                          )}
                        </div>
                        {/* Parent path shown below */}
                        {parentPath.length > 0 && (
                          <div className="text-xs font-mono text-zinc-400 mb-1 flex items-center gap-1 flex-wrap">
                            {parentPath.map((segment, i) => (
                              <span key={i} className="flex items-center gap-1">
                                <span>{segment}</span>
                                {i < parentPath.length - 1 && (
                                  <ChevronRight className="w-3 h-3 text-zinc-300" />
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Gist description */}
                        <div className="text-xs text-zinc-500">
                          {folder.gist}
                        </div>
                      </div>
                    </div>
                  );
                })}
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
