"use client";

import { useQueryClient } from "@tanstack/react-query";
import { VscFolder } from "react-icons/vsc";
import type { Folder } from "@/lib/types";
import { useFileBrowser } from "@/lib/file-browser-context";
import {
  folderContentsOptions,
  useRenameFolder,
  useDeleteFolder,
  formatCount,
} from "@/lib/queries";
import { ResourceRow } from "./resource-row";

type FolderRowProps = {
  folder: Folder;
  idx: number;
  isSharedWithMe: boolean;
  count?: number;
};

export function FolderRow({ folder, idx, isSharedWithMe, count }: FolderRowProps) {
  const queryClient = useQueryClient();
  const { navigateTo } = useFileBrowser();
  const renameMutation = useRenameFolder();
  const deleteMutation = useDeleteFolder();

  const prefetch = () => {
    queryClient.prefetchInfiniteQuery(folderContentsOptions(folder.id));
  };

  return (
    <ResourceRow
      resource={folder}
      resourceType="folder"
      idx={idx}
      isSharedWithMe={isSharedWithMe}
      icon={<VscFolder className="text-muted-foreground" />}
      metadata={
        <span className="text-muted-foreground w-32 text-right inline-flex items-center justify-end">
          {count !== undefined ? (
            `${formatCount(count)} items`
          ) : (
            <span className="inline-block w-16 h-3 bg-border rounded animate-pulse" />
          )}
        </span>
      }
      onClick={() => navigateTo(folder.id, folder)}
      onRename={(name) => renameMutation.mutateAsync({ id: folder.id, name })}
      onDelete={() => deleteMutation.mutateAsync(folder.id)}
      onMouseEnter={prefetch}
    />
  );
}
