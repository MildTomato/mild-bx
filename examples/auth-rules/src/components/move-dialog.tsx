"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FolderTree } from "./folder-tree";
import { useMoveFile, useMoveFolder } from "@/lib/queries";
import type { Folder, File } from "@/lib/types";

type MoveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: Folder | File | null;
  resourceType: "folder" | "file";
};

export function MoveDialog({ open, onOpenChange, resource, resourceType }: MoveDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const moveFile = useMoveFile();
  const moveFolder = useMoveFolder();

  const isPending = moveFile.isPending || moveFolder.isPending;
  const hasSelection = selectedFolderId !== undefined;

  const handleFolderSelect = useCallback((id: string | null) => {
    setSelectedFolderId(id);
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedFolderId(undefined);
      setError(null);
    }
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  async function handleMove() {
    if (!resource || selectedFolderId === undefined) return;
    setError(null);

    try {
      if (resourceType === "file") {
        await moveFile.mutateAsync({
          fileId: resource.id,
          destinationFolderId: selectedFolderId,
        });
      } else {
        await moveFolder.mutateAsync({
          folderId: resource.id,
          destinationFolderId: selectedFolderId,
        });
      }
      setSelectedFolderId(undefined);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else if (typeof err === "object" && err !== null && "message" in err) {
        setError(String((err as { message: unknown }).message));
      } else {
        setError("Failed to move. You may not have permission.");
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move &ldquo;{resource?.name}&rdquo;</DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <p className="text-sm text-muted-foreground mb-3">Select a destination folder:</p>
          {resource && (
            <FolderTree
              excludeId={resource.id}
              excludeIsFolder={resourceType === "folder"}
              onSelect={handleFolderSelect}
            />
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleMove}
            disabled={!hasSelection || isPending}
          >
            {isPending ? "Moving..." : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
