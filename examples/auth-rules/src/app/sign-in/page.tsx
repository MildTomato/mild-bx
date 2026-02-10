"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { LogoShapesWave } from "@/components/logo";
import { supabase } from "@/lib/supabase";

export default function SignInPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => setMounted(true), []);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <LogoShapesWave className="fixed top-4 left-4" />
      {mounted && (
        <div className="fixed top-4 right-4 flex gap-1 text-xs">
          {(["light", "dark", "system"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`px-2 py-1 rounded border ${theme === t ? "border-fg-muted bg-bg-secondary text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={handleSignIn} className="w-full max-w-xs space-y-4">
        <h1 className="text-lg font-medium">Sign in</h1>
        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 bg-bg-secondary border border-border rounded outline-none focus:border-fg-muted"
          required
        />
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 bg-bg-secondary border border-border rounded outline-none focus:border-fg-muted"
          required
        />
        {error && <p className="text-red-500">{error}</p>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Signing in..." : "Sign in"}
        </Button>
        <p className="text-sm text-fg-muted text-center">
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className="text-fg hover:underline">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}
