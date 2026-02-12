"use client";

import { useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { VscGlobe } from "react-icons/vsc";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useFileBrowser } from "@/lib/file-browser-context";
import type { Folder } from "@/lib/types";

type AppHeaderProps = {
  user: User;
};

export function AppHeader({ user }: AppHeaderProps) {
  const { currentFolder, currentFolderData, navigateTo } = useFileBrowser();
  const [breadcrumbs, setBreadcrumbs] = useState<Folder[]>([]);
  const [loadingAncestors, setLoadingAncestors] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;

    async function loadBreadcrumbs() {
      const crumbs: Folder[] = currentFolderData ? [currentFolderData] : [];
      let id = currentFolderData?.parent_id ?? (currentFolderData ? null : currentFolder);

      // If we don't have optimistic data, fetch the current folder first
      if (!currentFolderData && currentFolder) {
        const { data } = await supabase
          .from("folders")
          .select("id, name, parent_id, owner_id")
          .eq("id", currentFolder)
          .single();
        if (data && !cancelled) {
          crumbs.push(data);
          id = data.parent_id;
        }
      }

      // Show loading indicator if there are ancestors to fetch
      if (id && !cancelled) setLoadingAncestors(true);

      // Fetch all ancestors, then set breadcrumbs once
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
      if (!cancelled) {
        setBreadcrumbs(crumbs);
        setLoadingAncestors(false);
      }
    }

    if (currentFolder) {
      // Show current folder immediately, ancestors load in background
      if (currentFolderData) {
        setBreadcrumbs([currentFolderData]);
        if (currentFolderData.parent_id) setLoadingAncestors(true);
      }
      loadBreadcrumbs();
    } else {
      setBreadcrumbs([]);
      setLoadingAncestors(false);
    }

    return () => { cancelled = true; };
  }, [currentFolder, currentFolderData]);

  // Check which breadcrumb folders have direct shares (for globe icon)
  const [sharedFolderIds, setSharedFolderIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!breadcrumbs.length) {
      setSharedFolderIds(new Set());
      return;
    }
    let cancelled = false;
    const ids = breadcrumbs.map((f) => f.id);
    supabase
      .from("shares")
      .select("resource_id")
      .in("resource_id", ids)
      .then(({ data }) => {
        if (!cancelled && data) {
          setSharedFolderIds(new Set(data.map((s) => s.resource_id)));
        }
      });
    return () => { cancelled = true; };
  }, [breadcrumbs]);

  useEffect(() => {
    const handleClick = () => setUserMenuOpen(false);
    if (userMenuOpen) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [userMenuOpen]);

  async function signOut() {
    await supabase.auth.signOut();
    navigateTo(null);
  }

  function handleNavigate(folderId: string | null) {
    startTransition(() => navigateTo(folderId));
  }

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleNavigate(null)}
          className="hover:text-fg-muted font-medium"
        >
          Files
        </button>
        {loadingAncestors && (
          <span className="flex items-center gap-2">
            <span className="text-fg-muted">/</span>
            <span className="text-fg-muted">...</span>
          </span>
        )}
        {breadcrumbs.map((folder) => (
          <span key={folder.id} className="flex items-center gap-2">
            <span className="text-fg-muted">/</span>
            <button
              onClick={() => handleNavigate(folder.id)}
              className="hover:text-fg-muted flex items-center gap-1"
            >
              {sharedFolderIds.has(folder.id) && (
                <VscGlobe className="text-shared text-xs shrink-0" />
              )}
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
  );
}
