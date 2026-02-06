"use client";

import { useState, useEffect } from "react";
import { VscFile, VscCalendar, VscAccount, VscLock } from "react-icons/vsc";
import { useFileBrowser } from "@/lib/file-browser-context";
import { useUpdateFileContent, useMyPermission, useResourceShares } from "@/lib/queries";
import { FileComments } from "./file-comments";
import { supabase } from "@/lib/supabase";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPermissionBadge(permission: string | null | undefined): { label: string; className: string } {
  switch (permission) {
    case "owner":
      return { label: "Owner", className: "bg-primary text-primary-foreground" };
    case "edit":
      return { label: "Can edit", className: "bg-emerald-600 text-white" };
    case "comment":
      return { label: "Can comment", className: "bg-sky-600 text-white" };
    case "view":
      return { label: "View only", className: "bg-fg-muted/30 text-fg-muted" };
    default:
      return { label: "—", className: "bg-border text-fg-muted" };
  }
}

export function FilePreview() {
  const { selectedFile, selectFile } = useFileBrowser();
  const [fileContent, setFileContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState("");
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);

  const updateFileContentMutation = useUpdateFileContent();
  const { data: permission, isPending: permissionPending } = useMyPermission(
    "file",
    selectedFile?.id ?? "",
    selectedFile?.owner_id ?? ""
  );
  const { data: shares } = useResourceShares("file", selectedFile?.id ?? "");
  const canEdit = permission === "owner" || permission === "edit";
  const canComment = permission === "owner" || permission === "edit" || permission === "comment";

  // Fetch owner email
  useEffect(() => {
    if (!selectedFile?.owner_id) {
      setOwnerEmail(null);
      return;
    }
    supabase
      .from("users")
      .select("email")
      .eq("id", selectedFile.owner_id)
      .single()
      .then(({ data }) => setOwnerEmail(data?.email ?? null));
  }, [selectedFile?.owner_id]);

  useEffect(() => {
    if (selectedFile) {
      setFileContent(selectedFile.content || "");
      setIsEditing(false);
    }
  }, [selectedFile]);

  async function saveFileContent() {
    if (!selectedFile) return;
    try {
      await updateFileContentMutation.mutateAsync({
        id: selectedFile.id,
        content: fileContent,
      });
      selectFile({ ...selectedFile, content: fileContent });
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    }
  }

  if (!selectedFile) return null;

  return (
    <aside className="w-1/2 max-w-xl flex flex-col border-l border-border">
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
          ) : canEdit ? (
            <button onClick={() => setIsEditing(true)} className="px-2 py-1 bg-bg-secondary border border-border rounded hover:bg-border">
              Edit
            </button>
          ) : null}
          <button onClick={() => selectFile(null)} className="px-2 py-1 text-fg-muted hover:text-fg">
            Close
          </button>
        </div>
      </div>

      {/* Metadata panel */}
      <div className="px-4 py-3 border-b border-border bg-bg-secondary">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="flex items-center gap-2 text-fg-muted">
            <VscFile className="shrink-0" />
            <span>Size</span>
          </div>
          <div className="text-fg">{formatFileSize(selectedFile.size)}</div>

          <div className="flex items-center gap-2 text-fg-muted">
            <VscCalendar className="shrink-0" />
            <span>Created</span>
          </div>
          <div className="text-fg">{formatDate(selectedFile.created_at)}</div>

          <div className="flex items-center gap-2 text-fg-muted">
            <VscAccount className="shrink-0" />
            <span>Owner</span>
          </div>
          <div className="text-fg truncate">{ownerEmail ?? "..."}</div>

          <div className="flex items-center gap-2 text-fg-muted">
            <VscLock className="shrink-0" />
            <span>Access</span>
          </div>
          <div className="flex items-center gap-2">
            {permissionPending ? (
              <span className="w-16 h-5 bg-border rounded animate-pulse" />
            ) : (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${getPermissionBadge(permission).className}`}>
                {getPermissionBadge(permission).label}
              </span>
            )}
            {shares && shares.length > 0 && (
              <span className="text-xs text-fg-muted">
                +{shares.length} shared
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-red-500 px-4 py-2">{error}</p>}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 p-4 overflow-auto">
          {isEditing ? (
            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              className="w-full h-full min-h-[200px] bg-bg-secondary border border-border rounded p-3 font-mono outline-none focus:border-fg-muted resize-none"
              placeholder="Enter file content..."
            />
          ) : (
            <pre className="font-mono whitespace-pre-wrap text-fg-muted">
              {selectedFile.content || <span className="italic">Empty file</span>}
            </pre>
          )}
        </div>
        {canComment && <FileComments fileId={selectedFile.id} canComment={canComment} />}
      </div>
    </aside>
  );
}
