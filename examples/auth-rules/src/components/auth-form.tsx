"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export function AuthForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

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
