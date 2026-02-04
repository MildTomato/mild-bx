"use client";

import { useEffect, useState, useRef, useTransition, useMemo } from "react";
import { useTheme } from "next-themes";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import type { Folder, File } from "@/lib/types";
import { FolderRow } from "@/components/FolderRow";
import { FileRow } from "@/components/FileRow";
import { VirtualList } from "@/components/VirtualList";
import {
  useFolderContents,
  useCreateFolder,
  useCreateFile,
  useUpdateFileContent,
} from "@/lib/queries";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Folder[]>([]);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useTheme();

  // React 18 useTransition for non-urgent folder navigation
  const [isPending, startTransition] = useTransition();

  // React Query hooks
  const {
    data,
    isPending: contentLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useFolderContents(currentFolder);

  const createFolderMutation = useCreateFolder();
  const createFileMutation = useCreateFile();
  const updateFileContentMutation = useUpdateFileContent();

  // Flatten paginated data for virtual list
  const { folders, files } = useMemo(() => {
    if (!data?.pages) return { folders: [], files: [] };
    const allFolders: Folder[] = [];
    const allFiles: File[] = [];
    for (const page of data.pages) {
      allFolders.push(...page.folders);
      allFiles.push(...page.files);
    }
    return { folders: allFolders, files: allFiles };
  }, [data?.pages]);

  // Combined items for virtual scrolling
  const allItems = useMemo(() => {
    return [
      ...folders.map((f) => ({ type: "folder" as const, data: f })),
      ...files.map((f) => ({ type: "file" as const, data: f })),
    ];
  }, [folders, files]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
  }, []);

  // Load breadcrumbs when folder changes
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function loadBreadcrumbs() {
      const crumbs: Folder[] = [];
      let id = currentFolder;
      while (id) {
        const { data } = await supabase
          .from("folders")
          .select("id, name, parent_id, owner_id")
          .eq("id", id)
          .single();
        if (data) {
          crumbs.unshift(data);
          id = data.parent_id;
        } else break;
      }
      if (!cancelled) setBreadcrumbs(crumbs);
    }
    loadBreadcrumbs();

    return () => {
      cancelled = true;
    };
  }, [user, currentFolder]);

  useEffect(() => {
    if ((showNewFolderInput || showNewFileInput) && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showNewFolderInput, showNewFileInput]);

  useEffect(() => {
    const handleClick = () => setUserMenuOpen(false);
    if (userMenuOpen) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [userMenuOpen]);

  async function signIn() {
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }

  async function signUp() {
    setError("");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setCurrentFolder(null);
    setBreadcrumbs([]);
  }

  function navigateTo(folderId: string | null) {
    startTransition(() => {
      setSelectedFile(null);
      setCurrentFolder(folderId);
    });
  }

  async function createFolder() {
    if (!newItemName.trim() || !user) return;
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
    if (!newItemName.trim() || !user) return;
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

  function openFile(file: File) {
    setSelectedFile(file);
    setFileContent(file.content || "");
    setIsEditing(false);
  }

  async function saveFileContent() {
    if (!selectedFile) return;
    try {
      await updateFileContentMutation.mutateAsync({
        id: selectedFile.id,
        content: fileContent,
      });
      setSelectedFile({ ...selectedFile, content: fileContent });
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-fg-muted">...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="w-full max-w-xs space-y-4">
          <h1 className="text-lg font-medium">Sign in</h1>
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 bg-bg-secondary border border-border rounded outline-none focus:border-fg-muted"
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-bg-secondary border border-border rounded outline-none focus:border-fg-muted"
          />
          {error && <p className="text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button onClick={signIn} className="flex-1 px-3 py-2 bg-accent text-bg rounded hover:opacity-80">
              Sign in
            </button>
            <button onClick={signUp} className="flex-1 px-3 py-2 border border-border rounded hover:bg-bg-secondary">
              Sign up
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateTo(null)}
            className="hover:text-fg-muted font-medium"
          >
            Files
          </button>
          {breadcrumbs.map((folder) => (
            <span key={folder.id} className="flex items-center gap-2">
              <span className="text-fg-muted">/</span>
              <button
                onClick={() => navigateTo(folder.id)}
                className="hover:text-fg-muted"
              >
                {folder.name}
              </button>
            </span>
          ))}
          {isPending && <span className="text-fg-muted ml-2">...</span>}
        </div>
        <div className="relative">
          <button onClick={() => setUserMenuOpen(!userMenuOpen)} className="text-fg-muted hover:text-fg">
            {user.email} ▾
          </button>
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-bg border border-border rounded shadow-lg py-1 z-50 min-w-[150px]">
              <div className="px-4 py-2 text-fg-muted text-xs uppercase tracking-wide">Theme</div>
              {(["light", "dark", "system"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className="w-full px-4 py-2 text-left hover:bg-bg-secondary flex items-center gap-2"
                >
                  <span className={`w-3 h-3 rounded-full border ${theme === t ? "border-accent bg-accent" : "border-fg-muted"}`} />
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
              <div className="border-t border-border my-1" />
              <button
                onClick={() => { signOut(); setUserMenuOpen(false); }}
                className="w-full px-4 py-2 text-left hover:bg-bg-secondary text-red-500"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
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

      <div className="flex-1 flex overflow-hidden">
        <main className={`flex-1 flex flex-col ${selectedFile ? "border-r border-border" : ""}`}>
          {(showNewFolderInput || showNewFileInput) && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-bg-secondary rounded shrink-0">
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

          {contentLoading ? (
            <div className="animate-pulse">
              {/* Folder-like skeletons */}
              {[35, 50, 25].map((w, i) => (
                <div key={`f${i}`} className={`flex items-center gap-2 px-4 py-1 ${i % 2 === 0 ? "bg-bg-secondary/50" : ""}`}>
                  <div className="w-4 h-4 bg-border rounded" />
                  <div className="flex-1"><div className="h-3 bg-border rounded" style={{ width: `${w}%` }} /></div>
                  <div className="w-16 h-3 bg-border rounded" />
                  <span className="invisible flex items-center gap-1">
                    <span>rename</span>
                    <span>del</span>
                  </span>
                </div>
              ))}
              {/* File-like skeletons */}
              {[45, 60, 30, 55, 40].map((w, i) => (
                <div key={`e${i}`} className={`flex items-center gap-2 px-4 py-1 ${(3 + i) % 2 === 0 ? "bg-bg-secondary/50" : ""}`}>
                  <div className="w-4 h-4 bg-border rounded" />
                  <div className="flex-1"><div className="h-3 bg-border rounded" style={{ width: `${w}%` }} /></div>
                  <div className="w-20 h-3 bg-border rounded" />
                  <div className="w-16 h-3 bg-border rounded" />
                  <span className="invisible flex items-center gap-1">
                    <span>rename</span>
                    <span>del</span>
                  </span>
                </div>
              ))}
            </div>
          ) : allItems.length === 0 && !showNewFolderInput && !showNewFileInput ? (
            <p className="text-fg-muted p-3 px-4">Empty folder</p>
          ) : (
            <VirtualList
              items={allItems}
              hasNextPage={hasNextPage ?? false}
              fetchNextPage={fetchNextPage}
              isFetchingNextPage={isFetchingNextPage}
              getItemKey={(item) => item.data.id}
              renderItem={(item, idx) => {
                if (item.type === "folder") {
                  return (
                    <FolderRow
                      folder={item.data}
                      idx={idx}
                      onNavigate={navigateTo}
                    />
                  );
                } else {
                  return (
                    <FileRow
                      file={item.data}
                      idx={idx}
                      foldersCount={folders.length}
                      isSelected={selectedFile?.id === item.data.id}
                      onSelect={openFile}
                    />
                  );
                }
              }}
            />
          )}
        </main>

        {selectedFile && (
          <aside className="w-1/2 max-w-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-medium truncate">{selectedFile.name}</h2>
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <>
                    <button onClick={saveFileContent} className="px-2 py-1 bg-accent text-bg rounded hover:opacity-80">
                      Save
                    </button>
                    <button onClick={() => { setFileContent(selectedFile.content || ""); setIsEditing(false); }} className="px-2 py-1 text-fg-muted hover:text-fg">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button onClick={() => setIsEditing(true)} className="px-2 py-1 bg-bg-secondary border border-border rounded hover:bg-border">
                    Edit
                  </button>
                )}
                <button onClick={() => setSelectedFile(null)} className="px-2 py-1 text-fg-muted hover:text-fg">
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-auto">
              {isEditing ? (
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full h-full min-h-[300px] bg-bg-secondary border border-border rounded p-3 font-mono outline-none focus:border-fg-muted resize-none"
                  placeholder="Enter file content..."
                />
              ) : (
                <pre className="font-mono whitespace-pre-wrap text-fg-muted">
                  {selectedFile.content || <span className="italic">Empty file</span>}
                </pre>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
