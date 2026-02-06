import { useMemo } from "react";
import type { Folder, File } from "@/lib/types";

export type FolderItem = { type: "folder"; data: Folder; isSharedWithMe: boolean };
export type FileItem = { type: "file"; data: File; isSharedWithMe: boolean };
export type SectionHeaderItem = { type: "section-header"; label: string; isSharedSection: boolean };
export type ListItem = FolderItem | FileItem | SectionHeaderItem;

export function useSortedItems(
  folders: Folder[],
  files: File[],
  userId: string | undefined,
  isInsideSharedFolder: boolean = false
): ListItem[] {
  return useMemo(() => {
    // When inside a shared folder, don't mark individual items as shared
    // since the folder banner already indicates this
    const items: (FolderItem | FileItem)[] = [
      ...folders.map((f) => ({
        type: "folder" as const,
        data: f,
        isSharedWithMe: isInsideSharedFolder ? false : f.owner_id !== userId
      })),
      ...files.map((f) => ({
        type: "file" as const,
        data: f,
        isSharedWithMe: isInsideSharedFolder ? false : f.owner_id !== userId
      })),
    ];

    // Sort shared items to the top
    items.sort((a, b) => {
      if (a.isSharedWithMe && !b.isSharedWithMe) return -1;
      if (!a.isSharedWithMe && b.isSharedWithMe) return 1;
      return 0;
    });

    const hasShared = items.some((i) => i.isSharedWithMe);
    const hasOwned = items.some((i) => !i.isSharedWithMe);
    const result: ListItem[] = [];

    if (hasShared) {
      result.push({ type: "section-header", label: "Shared with me", isSharedSection: true });
    }

    let addedOwnedHeader = false;
    for (const item of items) {
      if (!item.isSharedWithMe && hasShared && hasOwned && !addedOwnedHeader) {
        result.push({ type: "section-header", label: "My files", isSharedSection: false });
        addedOwnedHeader = true;
      }
      result.push(item);
    }

    return result;
  }, [folders, files, userId, isInsideSharedFolder]);
}
