"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { FileBrowserProvider } from "@/lib/file-browser-context";
import { AppHeader } from "@/components/app-header";
import { FileToolbar } from "@/components/file-toolbar";
import { FileList } from "@/components/file-list";
import { FilePreview } from "@/components/file-preview";
import { ShareDialogWrapper } from "@/components/share-dialog-wrapper";
import { SearchDialog } from "@/components/search-dialog";

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="h-5 w-5 border-2 border-fg-muted border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function HomeContent() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/sign-in");
        return;
      }
      setUser(data.user);
      setLoading(false);
    });
    supabase.auth.onAuthStateChange((_, session) => {
      if (!session?.user) {
        router.replace("/sign-in");
        return;
      }
      setUser(session.user);
    });
  }, [router]);

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <FileBrowserProvider>
      <div className="min-h-screen flex flex-col">
        <AppHeader user={user!} />
        <FileToolbar user={user!} />
        <div className="flex-1 flex overflow-hidden">
          <main className="flex-1 flex flex-col">
            <FileList />
          </main>
          <FilePreview />
        </div>
        <ShareDialogWrapper />
        <SearchDialog />
      </div>
    </FileBrowserProvider>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <HomeContent />
    </Suspense>
  );
}
