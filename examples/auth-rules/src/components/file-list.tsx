"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import type { Folder } from "@/lib/types";
import { useFileBrowser } from "@/lib/file-browser-context";
import { useFolderContents, useFolder, useSequentialFolderCounts } from "@/lib/queries";
import { useSortedItems, type ListItem } from "@/hooks/use-sorted-items";
import { VirtualList } from "./virtual-list";
import { FolderRow } from "./folder-row";
import { FileRow } from "./file-row";
import { SectionHeader } from "./section-header";
import { SharedFolderBanner } from "./shared-folder-banner";

export function FileList() {
  const { currentFolder, currentFolderData: optimisticFolderData } = useFileBrowser();
  const [user, setUser] = useState<User | null>(null);
  const [wasSharedWithMe, setWasSharedWithMe] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  const {
    data,
    isPending: contentLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useFolderContents(currentFolder);

  const { data: fetchedFolderData } = useFolder(currentFolder);

  // Use optimistic data first, fall back to fetched data
  const currentFolderData = optimisticFolderData ?? fetchedFolderData;

  // Determine if shared - use optimistic data, or inherit from previous state while loading
  const isCurrentFolderSharedWithMe = currentFolderData && user
    ? currentFolderData.owner_id !== user.id
    : wasSharedWithMe; // Keep previous state while loading

  // Update the "was shared" state when we have definitive data
  useEffect(() => {
    if (currentFolderData && user) {
      setWasSharedWithMe(currentFolderData.owner_id !== user.id);
    } else if (currentFolder === null) {
      setWasSharedWithMe(false); // Reset when going to root
    }
  }, [currentFolderData, user, currentFolder]);

  // Flatten paginated data
  const folders = data?.pages?.flatMap((p) => p.folders) ?? [];
  const files = data?.pages?.flatMap((p) => p.files) ?? [];

  // Only show "shared with me" styling at root level - inside folders, the banner indicates shared status
  const isInsideAnyFolder = currentFolder !== null;
  const allItems = useSortedItems(folders, files, user?.id, isInsideAnyFolder);

  // Fetch folder counts sequentially (one at a time) to avoid overwhelming the database
  const folderIds = useMemo(
    () => allItems.filter((item) => item.type === "folder").map((item) => item.data.id),
    [allItems]
  );
  const { counts: folderCounts } = useSequentialFolderCounts(folderIds);

  // Wait for both content and user to load to avoid flash of incorrect shared state
  if (contentLoading || !user) {
    return (
      <div className="animate-pulse">
        {[40, 55, 30].map((w, i) => (
          <div key={`f${i}`} className={`flex items-center gap-3 px-4 py-2 ${i % 2 === 0 ? "bg-row-alt" : ""}`}>
            <div className="w-4 h-4 bg-border rounded" />
            <div className="flex-1"><div className="h-4 bg-border rounded" style={{ width: `${w}%` }} /></div>
            <div className="w-32 h-4 bg-border rounded" />
            <div className="w-6 h-6 bg-border rounded" />
          </div>
        ))}
        {[50, 65, 35, 45].map((w, i) => (
          <div key={`e${i}`} className={`flex items-center gap-3 px-4 py-2 ${(3 + i) % 2 === 0 ? "bg-row-alt" : ""}`}>
            <div className="w-4 h-4 bg-border rounded" />
            <div className="flex-1"><div className="h-4 bg-border rounded" style={{ width: `${w}%` }} /></div>
            <div className="w-24 h-4 bg-border rounded" />
            <div className="w-24 h-4 bg-border rounded" />
            <div className="w-6 h-6 bg-border rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (allItems.length === 0) {
    return <p className="text-fg-muted p-3 px-4">Empty folder</p>;
  }

  // Show banner if we have folder data, OR if we're in a folder and it was previously shared
  const showSharedBanner = currentFolder !== null && (currentFolderData || wasSharedWithMe);

  return (
    <>
      {showSharedBanner && currentFolderData && (
        <SharedFolderBanner
          folder={currentFolderData}
          isSharedWithMe={isCurrentFolderSharedWithMe}
        />
      )}
      {showSharedBanner && !currentFolderData && wasSharedWithMe && (
        <div className="flex items-center gap-3 px-4 py-2 bg-shared-bg border-b border-shared/20">
          <span className="text-shared text-sm">This folder is shared with you</span>
        </div>
      )}
      <VirtualList
        items={allItems}
        hasNextPage={hasNextPage ?? false}
        fetchNextPage={fetchNextPage}
        isFetchingNextPage={isFetchingNextPage}
        getItemKey={(item) => item.type === "section-header" ? `header-${item.label}` : item.data.id}
        renderItem={(item: ListItem, idx: number) => {
          if (item.type === "section-header") {
            return <SectionHeader label={item.label} isSharedSection={item.isSharedSection} />;
          }
          if (item.type === "folder") {
            return (
              <FolderRow
                folder={item.data}
                idx={idx}
                isSharedWithMe={item.isSharedWithMe}
                count={folderCounts[item.data.id]}
              />
            );
          }
          return <FileRow file={item.data} idx={idx} isSharedWithMe={item.isSharedWithMe} />;
        }}
      />
    </>
  );
}
