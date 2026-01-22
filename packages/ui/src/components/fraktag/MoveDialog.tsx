import { useState, useEffect, useMemo, useCallback } from "react";
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
  Move,
  Folder,
  ChevronRight,
  FolderPlus,
  X,
} from "lucide-react";
import { TreeNode } from "./TreeItem";

interface MoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  treeId: string;
  nodeId: string;
  nodeType: string;
  flatList: TreeNode[];
  childrenMap: Record<string, TreeNode[]>;
  onComplete?: () => void;
}

export function MoveDialog({
  open,
  onOpenChange,
  treeId,
  nodeId,
  nodeType,
  flatList,
  childrenMap,
  onComplete,
}: MoveDialogProps) {
  const [targetId, setTargetId] = useState("");
  const [moving, setMoving] = useState(false);

  // Folder creation state
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [createInFolderId, setCreateInFolderId] = useState("");
  const [newFolderTitle, setNewFolderTitle] = useState("");
  const [newFolderGist, setNewFolderGist] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setTargetId("");
        setShowCreateFolder(false);
        setCreateInFolderId("");
        setNewFolderTitle("");
        setNewFolderGist("");
      }, 300);
    }
  }, [open]);

  // Check if folder can have new subfolder (must have no content children)
  const canCreateSubfolder = useCallback(
    (folderId: string): boolean => {
      const children = childrenMap[folderId] || [];
      // Can create subfolder if: no children, or all children are folders
      return children.every((c) => c.type === "folder");
    },
    [childrenMap]
  );

  // Check if folder can receive content (must be a leaf folder - no folder children)
  const canReceiveContent = useCallback(
    (folderId: string): boolean => {
      const children = childrenMap[folderId] || [];
      // Can receive content if no children, or no folder children
      return children.every((c) => c.type !== "folder");
    },
    [childrenMap]
  );

  // Build path for a folder by traversing up the tree
  const buildFolderPath = useCallback(
    (folder: TreeNode): string[] => {
      const pathParts: string[] = [];
      let currentId: string | null = folder.id;

      while (currentId) {
        const node = flatList.find((n) => n.id === currentId);
        if (node) {
          pathParts.unshift(node.title);
          currentId = node.parentId;
        } else {
          break;
        }
      }

      return pathParts.length > 0 ? pathParts : [folder.title];
    },
    [flatList]
  );

  // Get valid move targets with paths
  const validMoveTargets = useMemo(() => {
    if (!nodeType || !flatList) return [];

    return flatList
      .filter((n) => {
        if (n.type !== "folder") return false;
        if (n.id === nodeId) return false; // Can't move to self

        // Check if this is the node being moved or its descendant
        let current: TreeNode | null = n;
        while (current) {
          if (current.id === nodeId) return false;
          current = flatList.find((p) => p.id === current?.parentId) || null;
        }

        if (nodeType === "folder") {
          // Folders can move anywhere
          return true;
        } else {
          // Documents/fragments can only go to leaf folders
          return canReceiveContent(n.id);
        }
      })
      .map((folder) => ({
        ...folder,
        path: buildFolderPath(folder),
        canCreateSubfolder: canCreateSubfolder(folder.id),
      }));
  }, [nodeType, nodeId, flatList, canReceiveContent, canCreateSubfolder, buildFolderPath]);

  // Execute the move
  const executeMove = async () => {
    if (!nodeId || !targetId) return;
    setMoving(true);
    try {
      await axios.patch(`/api/nodes/${nodeId}/move`, {
        newParentId: targetId,
      });
      onOpenChange(false);
      onComplete?.();
    } catch (e) {
      console.error("Failed to move node:", e);
    } finally {
      setMoving(false);
    }
  };

  // Create a new folder
  const createFolder = async () => {
    if (!newFolderTitle.trim() || !newFolderGist.trim() || !createInFolderId) return;
    setCreatingFolder(true);
    try {
      const res = await axios.post(`/api/trees/${treeId}/folders`, {
        parentId: createInFolderId,
        title: newFolderTitle,
        gist: newFolderGist,
      });
      // Select the newly created folder as target
      setTargetId(res.data.id);
      setShowCreateFolder(false);
      setNewFolderTitle("");
      setNewFolderGist("");
      onComplete?.(); // Refresh tree to show new folder
    } catch (e) {
      console.error("Failed to create folder:", e);
    } finally {
      setCreatingFolder(false);
    }
  };

  // Start creating a folder inside a specific parent
  const startCreateFolder = (parentId: string) => {
    setCreateInFolderId(parentId);
    setNewFolderTitle("");
    setNewFolderGist("");
    setShowCreateFolder(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Move className="w-5 h-5 text-purple-500" />
            Move {nodeType === "folder" ? "Folder" : nodeType === "document" ? "Document" : "Fragment"}
          </DialogTitle>
          <DialogDescription>
            {nodeType === "folder"
              ? "Select a folder to move this folder into (along with all its contents)."
              : "Select a leaf folder (without subfolders) to move this content into."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden pt-4">
          {showCreateFolder ? (
            // Create Folder Form
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-700 flex items-center gap-2">
                  <FolderPlus className="w-4 h-4 text-blue-500" />
                  Create New Folder
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateFolder(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="bg-zinc-50 rounded-lg p-3 text-sm text-zinc-600">
                Creating folder inside:{" "}
                <span className="font-medium">
                  {flatList.find((f) => f.id === createInFolderId)?.title || "Unknown"}
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Folder Title
                </label>
                <Input
                  value={newFolderTitle}
                  onChange={(e) => setNewFolderTitle(e.target.value)}
                  placeholder="Enter folder title..."
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Description (Gist)
                </label>
                <textarea
                  value={newFolderGist}
                  onChange={(e) => setNewFolderGist(e.target.value)}
                  placeholder="What does this folder contain?"
                  className="w-full mt-1 min-h-[80px] p-3 text-sm border rounded-lg resize-y"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowCreateFolder(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={createFolder}
                  disabled={!newFolderTitle.trim() || !newFolderGist.trim() || creatingFolder}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {creatingFolder ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FolderPlus className="w-4 h-4" />
                  )}
                  Create & Select
                </Button>
              </div>
            </div>
          ) : (
            // Folder Selection
            <>
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 block">
                Select Target Folder ({validMoveTargets.length} valid targets)
              </label>
              <ScrollArea className="h-[350px] border rounded-lg">
                <div className="p-2 space-y-1">
                  {validMoveTargets.map((folder) => (
                    <div
                      key={folder.id}
                      className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        targetId === folder.id
                          ? "bg-purple-50 border border-purple-200"
                          : "hover:bg-zinc-50 border border-transparent"
                      }`}
                      onClick={() => setTargetId(folder.id)}
                    >
                      <Folder
                        className={`w-5 h-5 mt-0.5 shrink-0 ${
                          targetId === folder.id ? "text-purple-600" : "text-blue-500"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        {/* Full path with folder name bold at the end */}
                        <div className="text-sm mb-1 flex items-center gap-1 flex-wrap">
                          {folder.path.map((segment, i) => (
                            <span key={i} className="flex items-center gap-1">
                              <span
                                className={
                                  i === folder.path.length - 1
                                    ? "font-semibold text-zinc-900"
                                    : "text-zinc-500"
                                }
                              >
                                {segment}
                              </span>
                              {i < folder.path.length - 1 && (
                                <ChevronRight className="w-3 h-3 text-zinc-300" />
                              )}
                            </span>
                          ))}
                        </div>
                        {/* Gist description */}
                        <div className="text-xs text-zinc-500">{folder.gist}</div>
                      </div>

                      {/* Create subfolder button - only show for folders that can have subfolders */}
                      {folder.canCreateSubfolder && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-zinc-400 hover:text-blue-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            startCreateFolder(folder.id);
                          }}
                          title="Create subfolder inside this folder"
                        >
                          <FolderPlus className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {validMoveTargets.length === 0 && (
                    <div className="p-4 text-center text-zinc-400 text-sm">
                      No valid target folders available
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </div>

        {!showCreateFolder && (
          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={executeMove}
              disabled={!targetId || moving}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {moving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Move className="w-4 h-4" />
              )}
              Move Here
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
