"use client";

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
import { useFileBrowser } from "@/lib/file-browser-context";
import { useRenameFile, useDeleteFile } from "@/lib/queries";
import { ResourceRow } from "./resource-row";

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
    default: return <VscFile className="text-muted-foreground" />;
  }
}

type FileRowProps = {
  file: File;
  idx: number;
  isSharedWithMe: boolean;
};

export function FileRow({ file, idx, isSharedWithMe }: FileRowProps) {
  const { selectFile, selectedFile } = useFileBrowser();
  const renameMutation = useRenameFile();
  const deleteMutation = useDeleteFile();
  const isSelected = selectedFile?.id === file.id;

  return (
    <ResourceRow
      resource={file}
      resourceType="file"
      idx={idx}
      isSharedWithMe={isSharedWithMe}
      isSelected={isSelected}
      icon={getFileIcon(file.name)}
      metadata={
        <>
          <span className="text-muted-foreground w-24">{getFileType(file.name)}</span>
          <span className="text-muted-foreground w-24 text-right">{formatSize(file.size)}</span>
        </>
      }
      onClick={() => selectFile(file)}
      onRename={(name) => renameMutation.mutateAsync({ id: file.id, name })}
      onDelete={() => deleteMutation.mutateAsync(file.id)}
    />
  );
}
