"use client";

import { useEffect, useState, useCallback } from "react";
import { LoaderIcon, MessageSquareIcon } from "lucide-react";
import {
  VscFolder,
  VscFile,
  VscFileCode,
  VscFilePdf,
  VscFileMedia,
  VscJson,
  VscMarkdown,
  VscTable,
  VscGlobe,
} from "react-icons/vsc";
import { useFileBrowser } from "@/lib/file-browser-context";
import { useSearch, type SearchResult } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { stringToColor, getInitials } from "@/lib/avatar-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";

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
    mp4: "video", mov: "video", mp3: "audio", wav: "audio",
    js: "javascript", ts: "typescript", jsx: "react", tsx: "react",
    py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
    css: "styles", scss: "styles", html: "html", xml: "xml",
    yaml: "yaml", yml: "yaml", sh: "shell", sql: "sql",
    txt: "text", doc: "word", docx: "word",
  };
  return types[ext] || ext || "file";
}

function useCurrentUserId() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  return userId;
}

type ShareInfo = { shared_with_user_id: string; email: string | null; permission: string };

function useResultShares(results: SearchResult[]) {
  const [shareMap, setShareMap] = useState<Record<string, ShareInfo[]>>({});

  const resourceIds = results
    .filter((r) => r.result_type === "file" || r.result_type === "folder")
    .map((r) => r.id);
  const key = resourceIds.join(",");

  useEffect(() => {
    if (!resourceIds.length) {
      setShareMap({});
      return;
    }

    let cancelled = false;

    async function fetchAll() {
      const { data, error } = await supabase.rpc("get_resource_shares", {
        p_resource_ids: resourceIds,
      });

      if (cancelled) return;
      if (error || !data?.length) {
        setShareMap({});
        return;
      }

      const map: Record<string, ShareInfo[]> = {};
      for (const row of data) {
        if (!map[row.resource_id]) map[row.resource_id] = [];
        map[row.resource_id].push({
          shared_with_user_id: row.shared_with_user_id,
          email: row.shared_with_email ?? null,
          permission: row.permission,
        });
      }
      setShareMap(map);
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [key]);

  return shareMap;
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

function ResultIcon({ result, isShared }: { result: SearchResult; isShared: boolean }) {
  let icon;
  if (result.result_type === "folder") icon = <VscFolder className="text-muted-foreground" />;
  else if (result.result_type === "comment") icon = <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />;
  else icon = getFileIcon(result.name);

  if (!isShared) return icon;

  return (
    <span className="relative shrink-0">
      <VscGlobe className="absolute -left-2 -top-1 text-shared text-[10px]" />
      {icon}
    </span>
  );
}

function resultDescription(result: SearchResult): string | null {
  if (result.result_type === "folder") {
    if (result.file_size == null) return null;
    const count = result.file_size;
    return count === 0 ? "Empty" : `${count} item${count === 1 ? "" : "s"}`;
  }

  if (result.result_type === "comment") return null;

  const parts: string[] = [];
  parts.push(getFileType(result.name));
  if (result.file_size != null) parts.push(formatSize(result.file_size));
  return parts.join(" · ");
}

export function SearchDialog() {
  const { isSearchOpen, openSearch, closeSearch, navigateTo, navigateToFile } = useFileBrowser();
  const currentUserId = useCurrentUserId();
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(inputValue);
    }, 200);
    return () => clearTimeout(timer);
  }, [inputValue]);

  useEffect(() => {
    if (!isSearchOpen) {
      setInputValue("");
      setDebouncedQuery("");
    }
  }, [isSearchOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (isSearchOpen) {
          closeSearch();
        } else {
          openSearch();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSearchOpen, openSearch, closeSearch]);

  const { data: results, isLoading } = useSearch(debouncedQuery);
  const shareMap = useResultShares(results ?? []);

  const sortedResults = [...(results ?? [])].sort((a, b) => b.rank - a.rank);
  const hasResults = sortedResults.length > 0;
  const hasQuery = debouncedQuery.trim().length >= 2;

  const PER_TYPE_LIMIT = 20;
  const fileCount = sortedResults.filter((r) => r.result_type === "file").length;
  const folderCount = sortedResults.filter((r) => r.result_type === "folder").length;
  const commentCount = sortedResults.filter((r) => r.result_type === "comment").length;

  const handleSelect = useCallback(
    (result: SearchResult) => {
      closeSearch();
      switch (result.result_type) {
        case "file":
          navigateToFile(result.parent_id, {
            id: result.id,
            name: result.name,
            folder_id: result.parent_id,
            content: null,
            owner_id: result.owner_id ?? "",
            size: result.file_size ?? 0,
            created_at: "",
          });
          break;
        case "folder":
          navigateTo(result.id);
          break;
        case "comment":
          navigateTo(null);
          break;
      }
    },
    [closeSearch, navigateTo, navigateToFile]
  );

  return (
    <Dialog open={isSearchOpen} onOpenChange={(open) => !open && closeSearch()}>
      <DialogHeader className="sr-only">
        <DialogTitle>Search</DialogTitle>
        <DialogDescription>Search files, folders, and comments</DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          <CommandInput
            placeholder="Search files, folders, and comments..."
            value={inputValue}
            onValueChange={setInputValue}
          />
          {hasQuery && !isLoading && hasResults && (
            <div className="flex items-center gap-3 px-3 py-1.5 text-xs text-muted-foreground">
              <span>{sortedResults.length} result{sortedResults.length === 1 ? "" : "s"}</span>
              <span className="text-border">|</span>
              {fileCount > 0 && <span>{fileCount >= PER_TYPE_LIMIT ? `${fileCount}+` : fileCount} file{fileCount === 1 ? "" : "s"}</span>}
              {folderCount > 0 && <span>{folderCount >= PER_TYPE_LIMIT ? `${folderCount}+` : folderCount} folder{folderCount === 1 ? "" : "s"}</span>}
              {commentCount > 0 && <span>{commentCount >= PER_TYPE_LIMIT ? `${commentCount}+` : commentCount} comment{commentCount === 1 ? "" : "s"}</span>}
            </div>
          )}
          <CommandList>
            {hasQuery && !isLoading && !hasResults && (
              <CommandEmpty>No results found.</CommandEmpty>
            )}
            {isLoading && hasQuery && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <LoaderIcon className="size-4 animate-spin" />
                Searching...
              </div>
            )}
            {sortedResults.map((result) => {
              const desc = resultDescription(result);
              const isShared = !!(result.owner_id && currentUserId && result.owner_id !== currentUserId) || (shareMap[result.id]?.length > 0);
              return (
                <CommandItem
                  key={`${result.result_type}-${result.id}`}
                  value={`${result.result_type}-${result.id}`}
                  onSelect={() => handleSelect(result)}
                >
                  <ResultIcon result={result} isShared={isShared} />
                  <span className="truncate font-medium">{result.name}</span>
                  {shareMap[result.id] && shareMap[result.id].length > 0 && (
                    <div className="flex shrink-0 items-center -space-x-1">
                      {shareMap[result.id].slice(0, 3).map((s) => (
                        <div
                          key={s.shared_with_user_id}
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium text-white ring-1 ring-background"
                          style={{ backgroundColor: stringToColor(s.email ?? s.shared_with_user_id) }}
                          title={s.email ?? "Unknown"}
                        >
                          {getInitials(s.email ?? "?")}
                        </div>
                      ))}
                      {shareMap[result.id].length > 3 && (
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium bg-muted text-muted-foreground ring-1 ring-background">
                          +{shareMap[result.id].length - 3}
                        </div>
                      )}
                    </div>
                  )}
                  {desc && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{desc}</span>
                  )}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
