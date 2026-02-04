"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { VscFolder } from "react-icons/vsc";
import type { Folder } from "@/lib/types";
import {
  useFolderCount,
  folderContentsOptions,
  useRenameFolder,
  useDeleteFolder,
  formatCount,
} from "@/lib/queries";

export function FolderRow({
  folder,
  idx,
  onNavigate,
}: {
  folder: Folder;
  idx: number;
  onNavigate: (folderId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [error, setError] = useState("");

  // React Query hooks
  const { data: count, isPending: countPending } = useFolderCount(folder.id);
  const renameMutation = useRenameFolder();
  const deleteMutation = useDeleteFolder();

  // Prefetch folder contents on hover (Vercel best practice)
  const prefetch = () => {
    queryClient.prefetchInfiniteQuery(folderContentsOptions(folder.id));
  };

  async function handleRename() {
    if (!renameValue.trim() || renameValue === folder.name) {
      setIsRenaming(false);
      setRenameValue(folder.name);
      return;
    }

    try {
      await renameMutation.mutateAsync({ id: folder.id, name: renameValue.trim() });
      setIsRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync(folder.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div
      className={`group flex items-center gap-2 px-4 py-1 cursor-pointer ${idx % 2 === 0 ? "bg-bg-secondary/50" : ""}`}
      onMouseEnter={prefetch}
      onFocus={prefetch}
    >
      <VscFolder className="text-fg-muted shrink-0" />

      {isRenaming ? (
        <input
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            else if (e.key === "Escape") {
              setIsRenaming(false);
              setRenameValue(folder.name);
            }
          }}
          onBlur={handleRename}
          autoFocus
          className="flex-1 bg-transparent outline-none border-b border-accent"
        />
      ) : (
        <button
          onClick={() => onNavigate(folder.id)}
          className="flex-1 text-left truncate hover:underline"
        >
          {folder.name}
        </button>
      )}

      <span className="text-fg-muted w-24 text-right inline-flex items-center justify-end">
        {countPending ? (
          <span className="inline-block w-16 h-3 bg-border rounded animate-pulse" />
        ) : (
          `${formatCount(count ?? 0)} items`
        )}
      </span>

      <span className="invisible group-hover:visible flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsRenaming(true);
          }}
          className="text-fg-muted hover:text-fg"
        >
          rename
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          className="text-red-500 hover:text-red-400"
        >
          del
        </button>
      </span>

      {error && <span className="text-red-500 text-xs">{error}</span>}
    </div>
  );
}
