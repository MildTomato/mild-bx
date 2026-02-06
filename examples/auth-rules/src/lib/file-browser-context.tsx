"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Folder, File } from "./types";

type ShareTarget = {
  resource: Folder | File;
  type: "folder" | "file";
} | null;

type LinkShareTarget = {
  resource: Folder | File;
  type: "folder" | "file";
} | null;

type FileBrowserContextValue = {
  currentFolder: string | null;
  currentFolderData: Folder | null; // Optimistic folder data for instant breadcrumb display
  navigateTo: (folderId: string | null, folderData?: Folder) => void;
  selectedFile: File | null;
  pendingFileId: string | null; // File ID from URL that needs to be loaded
  selectFile: (file: File | null) => void;
  shareTarget: ShareTarget;
  openShareDialog: (resource: Folder | File, type: "folder" | "file") => void;
  closeShareDialog: () => void;
  linkShareTarget: LinkShareTarget;
  openLinkShareDialog: (resource: Folder | File, type: "folder" | "file") => void;
  closeLinkShareDialog: () => void;
};

const FileBrowserContext = createContext<FileBrowserContextValue | null>(null);

export function FileBrowserProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const folderFromUrl = searchParams.get("folder");
  const fileFromUrl = searchParams.get("file");
  const [currentFolder, setCurrentFolder] = useState<string | null>(folderFromUrl);
  const [currentFolderData, setCurrentFolderData] = useState<Folder | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareTarget>(null);
  const [linkShareTarget, setLinkShareTarget] = useState<LinkShareTarget>(null);

  // Build URL with current state
  const buildUrl = useCallback((folderId: string | null, fileId: string | null) => {
    const params = new URLSearchParams();
    if (folderId) params.set("folder", folderId);
    if (fileId) params.set("file", fileId);
    return params.toString() ? `?${params.toString()}` : "/";
  }, []);

  // Sync URL to state when URL changes (e.g., browser back/forward)
  useEffect(() => {
    if (folderFromUrl !== currentFolder) {
      setCurrentFolder(folderFromUrl);
      // Clear optimistic data when navigating via URL (back/forward)
      if (!folderFromUrl) {
        setCurrentFolderData(null);
      }
    }
    // Clear selected file if URL no longer has file param
    if (!fileFromUrl && selectedFile) {
      setSelectedFile(null);
    }
  }, [folderFromUrl, fileFromUrl, currentFolder, selectedFile]);

  const navigateTo = useCallback((folderId: string | null, folderData?: Folder) => {
    setSelectedFile(null);
    setCurrentFolder(folderId);
    setCurrentFolderData(folderData ?? null);

    // Update URL (clear file when navigating folders)
    router.push(buildUrl(folderId, null));
  }, [router, buildUrl]);

  const selectFile = useCallback((file: File | null) => {
    setSelectedFile(file);
    // Update URL with file ID
    router.push(buildUrl(currentFolder, file?.id ?? null));
  }, [router, buildUrl, currentFolder]);

  const openShareDialog = useCallback((resource: Folder | File, type: "folder" | "file") => {
    setShareTarget({ resource, type });
  }, []);

  const closeShareDialog = useCallback(() => {
    setShareTarget(null);
  }, []);

  const openLinkShareDialog = useCallback((resource: Folder | File, type: "folder" | "file") => {
    setLinkShareTarget({ resource, type });
  }, []);

  const closeLinkShareDialog = useCallback(() => {
    setLinkShareTarget(null);
  }, []);

  return (
    <FileBrowserContext.Provider
      value={{
        currentFolder,
        currentFolderData,
        navigateTo,
        selectedFile,
        pendingFileId: fileFromUrl && !selectedFile ? fileFromUrl : null,
        selectFile,
        shareTarget,
        openShareDialog,
        closeShareDialog,
        linkShareTarget,
        openLinkShareDialog,
        closeLinkShareDialog,
      }}
    >
      {children}
    </FileBrowserContext.Provider>
  );
}

export function useFileBrowser() {
  const context = useContext(FileBrowserContext);
  if (!context) {
    throw new Error("useFileBrowser must be used within FileBrowserProvider");
  }
  return context;
}
