"use client";

import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { FileBrowserProvider } from "@/lib/file-browser-context";
import { AuthForm } from "@/components/auth-form";
import { AppHeader } from "@/components/app-header";
import { FileToolbar } from "@/components/file-toolbar";
import { FileList } from "@/components/file-list";
import { FilePreview } from "@/components/file-preview";
import { ShareDialogWrapper } from "@/components/share-dialog-wrapper";

function HomeContent() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-fg-muted">...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  return (
    <FileBrowserProvider>
      <div className="min-h-screen flex flex-col">
        <AppHeader user={user} />
        <FileToolbar user={user} />
        <div className="flex-1 flex overflow-hidden">
          <main className="flex-1 flex flex-col">
            <FileList />
          </main>
          <FilePreview />
        </div>
        <ShareDialogWrapper />
      </div>
    </FileBrowserProvider>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><span className="text-fg-muted">...</span></div>}>
      <HomeContent />
    </Suspense>
  );
}
