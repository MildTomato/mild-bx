"use client";

import { useState } from "react";
import {
  VscFile,
  VscFileCode,
  VscFilePdf,
  VscFileMedia,
  VscJson,
  VscMarkdown,
  VscTable,
} from "react-icons/vsc";
import type { File } from "@/lib/types";
import { useRenameFile, useDeleteFile } from "@/lib/queries";

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getFileType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const types: Record<string, string> = {
    pdf: "pdf", json: "json", md: "markdown", mdx: "markdown",
    csv: "csv", xlsx: "excel", xls: "excel",
    png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image", webp: "image",
    mp4: "video", mov: "video", avi: "video", webm: "video",
    mp3: "audio", wav: "audio", ogg: "audio",
    js: "javascript", ts: "typescript", jsx: "react", tsx: "react",
    py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
    css: "styles", scss: "styles", html: "html", xml: "xml",
    yaml: "yaml", yml: "yaml", sh: "shell", sql: "sql",
    txt: "text", doc: "word", docx: "word",
    ppt: "powerpoint", pptx: "powerpoint",
    zip: "archive", tar: "archive", gz: "archive", rar: "archive",
  };
  return types[ext] || ext || "file";
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "pdf": return <VscFilePdf className="text-red-500" />;
    case "json": return <VscJson className="text-yellow-500" />;
    case "md": case "mdx": return <VscMarkdown className="text-blue-400" />;
    case "csv": case "xlsx": case "xls": return <VscTable className="text-green-500" />;
    case "png": case "jpg": case "jpeg": case "gif": case "svg": case "webp":
    case "mp4": case "mov": case "mp3": case "wav":
      return <VscFileMedia className="text-purple-500" />;
    case "js": case "ts": case "jsx": case "tsx": case "py": case "rb":
    case "go": case "rs": case "java": case "c": case "cpp": case "h":
    case "css": case "scss": case "html": case "xml": case "yaml": case "yml":
    case "sh": case "sql":
      return <VscFileCode className="text-orange-400" />;
    default: return <VscFile className="text-fg-muted" />;
  }
}

export function FileRow({
  file,
  idx,
  foldersCount,
  isSelected,
  onSelect,
}: {
  file: File;
  idx: number;
  foldersCount: number;
  isSelected: boolean;
  onSelect: (file: File) => void;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(file.name);
  const [error, setError] = useState("");

  // React Query mutation hooks
  const renameMutation = useRenameFile();
  const deleteMutation = useDeleteFile();

  async function handleRename() {
    if (!renameValue.trim() || renameValue === file.name) {
      setIsRenaming(false);
      setRenameValue(file.name);
      return;
    }

    try {
      await renameMutation.mutateAsync({ id: file.id, name: renameValue.trim() });
      setIsRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync(file.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div
      onClick={() => onSelect(file)}
      className={`group flex items-center gap-2 px-4 py-1 cursor-pointer ${(foldersCount + idx) % 2 === 0 ? "bg-bg-secondary/50" : ""} ${isSelected ? "bg-accent/20" : ""}`}
    >
      <span className="shrink-0">{getFileIcon(file.name)}</span>

      {isRenaming ? (
        <input
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            else if (e.key === "Escape") {
              setIsRenaming(false);
              setRenameValue(file.name);
            }
          }}
          onBlur={handleRename}
          autoFocus
          className="flex-1 bg-transparent outline-none border-b border-accent"
        />
      ) : (
        <span className="flex-1 truncate">{file.name}</span>
      )}

      <span className="text-fg-muted w-20">{getFileType(file.name)}</span>
      <span className="text-fg-muted w-16 text-right">{formatSize(file.size)}</span>

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
