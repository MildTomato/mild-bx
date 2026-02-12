"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { Folder as FolderIcon, Globe } from "lucide-react";
import type { TreeViewItem } from "@/components/tree-view";
import { supabase } from "@/lib/supabase";

const TreeView = dynamic(() => import("@/components/tree-view"), {
  loading: () => (
    <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
  ),
});

type FolderTreeProps = {
  /** ID of the resource being moved (to prevent selecting it or its descendants) */
  excludeId: string;
  /** Whether the resource being moved is a folder */
  excludeIsFolder: boolean;
  /** Called when a folder is selected */
  onSelect: (folderId: string | null) => void;
};

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  owner_id: string;
};

/** Build a nested TreeViewItem[] from a flat list of folders */
function buildTree(
  folders: FolderRow[],
  excludeId: string,
  excludeIsFolder: boolean,
  userId: string | null
): TreeViewItem[] {
  // Remove the excluded folder and all its descendants
  const excluded = new Set<string>();
  if (excludeIsFolder) {
    excluded.add(excludeId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of folders) {
        if (f.parent_id && excluded.has(f.parent_id) && !excluded.has(f.id)) {
          excluded.add(f.id);
          changed = true;
        }
      }
    }
  }

  const filtered = folders.filter((f) => !excluded.has(f.id));

  // Group by parent_id
  const childrenMap = new Map<string | null, FolderRow[]>();
  for (const f of filtered) {
    const key = f.parent_id;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(f);
  }

  function toTreeItems(parentId: string | null): TreeViewItem[] {
    const children = childrenMap.get(parentId) ?? [];
    return children
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => {
        const kids = toTreeItems(f.id);
        const isShared = userId ? f.owner_id !== userId : false;
        return {
          id: f.id,
          name: f.name,
          type: isShared ? "shared-folder" : "folder",
          ...(kids.length > 0 ? { children: kids } : {}),
        };
      });
  }

  return toTreeItems(null);
}

const ROOT_EXPANDED = ["__root__"];

export function FolderTree({ excludeId, excludeIsFolder, onSelect }: FolderTreeProps) {
  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [{ data: { user } }, { data, error: fetchError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("folders")
          .select("id, name, parent_id, owner_id")
          .order("name")
          .limit(5000),
      ]);
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }
      setUserId(user?.id ?? null);
      setFolders(data ?? []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const treeData = useMemo(() => {
    if (!folders) return [];
    const children = buildTree(folders, excludeId, excludeIsFolder, userId);
    return [
      {
        id: "__root__",
        name: "Root",
        type: "folder",
        ...(children.length > 0 ? { children } : {}),
      },
    ];
  }, [folders, excludeId, excludeIsFolder, userId]);

  const handleSelectionChange = useCallback(
    (selectedItems: TreeViewItem[]) => {
      if (selectedItems.length === 1) {
        const item = selectedItems[0];
        onSelect(item.id === "__root__" ? null : item.id);
      }
    },
    [onSelect]
  );

  const iconMap = useMemo(
    () => ({
      folder: <FolderIcon className="h-4 w-4 text-primary/80" />,
      "shared-folder": (
        <span className="relative">
          <FolderIcon className="h-4 w-4 text-primary/80" />
          <Globe className="absolute -left-1.5 -top-1 h-2.5 w-2.5 text-orange-500" />
        </span>
      ),
    }),
    []
  );

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        Loading folders...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive py-4 text-center">
        Failed to load folders: {error}
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-y-auto">
      <TreeView
        data={treeData}
        initialExpandedIds={ROOT_EXPANDED}
        showExpandAll={false}
        iconMap={iconMap}
        searchPlaceholder="Search folders..."
        onSelectionChange={handleSelectionChange}
      />
    </div>
  );
}
