"use client";

import { useState, useRef, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { useFileBrowser } from "@/lib/file-browser-context";
import { useCreateFolder, useCreateFile } from "@/lib/queries";

type FileToolbarProps = {
  user: User;
};

export function FileToolbar({ user }: FileToolbarProps) {
  const { currentFolder } = useFileBrowser();
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const createFolderMutation = useCreateFolder();
  const createFileMutation = useCreateFile();

  useEffect(() => {
    if ((showNewFolderInput || showNewFileInput) && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showNewFolderInput, showNewFileInput]);

  async function createFolder() {
    if (!newItemName.trim()) return;
    try {
      await createFolderMutation.mutateAsync({
        name: newItemName.trim(),
        parentId: currentFolder,
        ownerId: user.id,
      });
      setNewItemName("");
      setShowNewFolderInput(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
  }

  async function createFile() {
    if (!newItemName.trim()) return;
    try {
      await createFileMutation.mutateAsync({
        name: newItemName.trim(),
        folderId: currentFolder,
        ownerId: user.id,
      });
      setNewItemName("");
      setShowNewFileInput(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file");
    }
  }

  return (
    <div className="border-b border-border">
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          onClick={() => { setShowNewFolderInput(true); setShowNewFileInput(false); setNewItemName(""); }}
          className="px-2 py-0.5 bg-bg-secondary border border-border rounded hover:bg-border"
        >
          + New Folder
        </button>
        <button
          onClick={() => { setShowNewFileInput(true); setShowNewFolderInput(false); setNewItemName(""); }}
          className="px-2 py-0.5 bg-bg-secondary border border-border rounded hover:bg-border"
        >
          + New File
        </button>
        {error && <span className="text-red-500 ml-4">{error}</span>}
      </div>

      {(showNewFolderInput || showNewFileInput) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-secondary">
          <span className="text-fg-muted">{showNewFolderInput ? "📁" : "📄"}</span>
          <input
            ref={inputRef}
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (showNewFolderInput) createFolder();
                else createFile();
              } else if (e.key === "Escape") {
                setShowNewFolderInput(false);
                setShowNewFileInput(false);
                setNewItemName("");
              }
            }}
            placeholder={showNewFolderInput ? "Folder name" : "File name"}
            className="flex-1 bg-transparent outline-none"
          />
          <button onClick={() => { if (showNewFolderInput) createFolder(); else createFile(); }} className="text-accent hover:underline">
            Create
          </button>
          <button onClick={() => { setShowNewFolderInput(false); setShowNewFileInput(false); setNewItemName(""); }} className="text-fg-muted hover:text-fg">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
