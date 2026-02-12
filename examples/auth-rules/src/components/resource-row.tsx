"use client";

import { useState, type ReactNode } from "react";
import { VscEdit, VscShare, VscTrash, VscEllipsis, VscGlobe, VscLink, VscArrowRight } from "react-icons/vsc";
import { useFileBrowser } from "@/lib/file-browser-context";
import { useResourceShares, useMyPermission } from "@/lib/queries";
import type { Folder, File } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ShareAvatars } from "./share-avatars";

type ResourceRowProps = {
  resource: Folder | File;
  resourceType: "folder" | "file";
  idx: number;
  isSharedWithMe: boolean;
  isSelected?: boolean;
  icon: ReactNode;
  metadata: ReactNode;
  onClick: () => void;
  onRename: (newName: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onMouseEnter?: () => void;
};

export function ResourceRow({
  resource,
  resourceType,
  idx,
  isSharedWithMe,
  isSelected,
  icon,
  metadata,
  onClick,
  onRename,
  onDelete,
  onMouseEnter,
}: ResourceRowProps) {
  const { openShareDialog, openLinkShareDialog, openMoveDialog } = useFileBrowser();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(resource.name);
  const [error, setError] = useState("");

  const { data: shares } = useResourceShares(resourceType, resource.id);
  const { data: permission } = useMyPermission(resourceType, resource.id, resource.owner_id);
  const hasShares = shares && shares.length > 0;
  const canEdit = permission === "owner" || permission === "edit";
  const canDelete = permission === "owner";
  const canShare = permission === "owner";

  function getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "object" && err !== null) {
      if ("message" in err && typeof err.message === "string") return err.message;
      if ("error" in err && typeof err.error === "string") return err.error;
    }
    return String(err);
  }

  async function handleRename() {
    if (!renameValue.trim() || renameValue === resource.name) {
      setIsRenaming(false);
      setRenameValue(resource.name);
      return;
    }

    try {
      await onRename(renameValue.trim());
      setIsRenaming(false);
    } catch (err) {
      setError(getErrorMessage(err) || "Failed to rename");
    }
  }

  async function handleDelete() {
    try {
      await onDelete();
    } catch (err) {
      setError(getErrorMessage(err) || "Failed to delete");
    }
  }

  const menuItems = (
    <>
      {canEdit && (
        <ContextMenuItem onSelect={() => setIsRenaming(true)}>
          <VscEdit />
          Rename
        </ContextMenuItem>
      )}
      {canEdit && (
        <ContextMenuItem onSelect={() => openMoveDialog(resource, resourceType)}>
          <VscArrowRight />
          Move to...
        </ContextMenuItem>
      )}
      {canShare && (
        <ContextMenuItem onSelect={() => openShareDialog(resource, resourceType)}>
          <VscShare />
          Share
        </ContextMenuItem>
      )}
      {canShare && (
        <ContextMenuItem onSelect={() => openLinkShareDialog(resource, resourceType)}>
          <VscLink />
          Get Link
        </ContextMenuItem>
      )}
      {canDelete && (
        <ContextMenuItem variant="destructive" onSelect={handleDelete}>
          <VscTrash />
          Delete
        </ContextMenuItem>
      )}
    </>
  );

  const dropdownMenuItems = (
    <>
      {canEdit && (
        <DropdownMenuItem onSelect={() => setIsRenaming(true)}>
          <VscEdit />
          Rename
        </DropdownMenuItem>
      )}
      {canEdit && (
        <DropdownMenuItem onSelect={() => openMoveDialog(resource, resourceType)}>
          <VscArrowRight />
          Move to...
        </DropdownMenuItem>
      )}
      {canShare && (
        <DropdownMenuItem onSelect={() => openShareDialog(resource, resourceType)}>
          <VscShare />
          Share
        </DropdownMenuItem>
      )}
      {canShare && (
        <DropdownMenuItem onSelect={() => openLinkShareDialog(resource, resourceType)}>
          <VscLink />
          Get Link
        </DropdownMenuItem>
      )}
      {canDelete && (
        <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
          <VscTrash />
          Delete
        </DropdownMenuItem>
      )}
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`group flex items-center gap-3 px-4 py-2 cursor-pointer ${
            isSelected
              ? "bg-primary/20"
              : isSharedWithMe
                ? idx % 2 === 0
                  ? "bg-shared-bg-alt"
                  : "bg-shared-bg"
                : idx % 2 === 0
                  ? "bg-row-alt"
                  : ""
          }`}
          onMouseEnter={onMouseEnter}
          onFocus={onMouseEnter}
          onClick={onClick}
        >
          <span className="relative shrink-0">
            {(isSharedWithMe || hasShares) && (
              <VscGlobe className="absolute -left-2 -top-1 text-shared text-[10px]" />
            )}
            {icon}
          </span>

          <div className="flex-1 flex items-center gap-2 min-w-0">
            {isRenaming ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  else if (e.key === "Escape") {
                    setIsRenaming(false);
                    setRenameValue(resource.name);
                  }
                }}
                onBlur={handleRename}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                className="flex-1 bg-transparent outline-none border-b border-primary"
              />
            ) : (
              <span className="truncate">{resource.name}</span>
            )}
            {!isSharedWithMe && <ShareAvatars resource={resource} resourceType={resourceType} />}
          </div>

          {metadata}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <VscEllipsis />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {dropdownMenuItems}
            </DropdownMenuContent>
          </DropdownMenu>

          {error && <span className="text-destructive text-xs">{error}</span>}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {menuItems}
      </ContextMenuContent>
    </ContextMenu>
  );
}
