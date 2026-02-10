"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/");
    }
  }

  return (
    <form onSubmit={handleSignUp} className="w-full max-w-xs space-y-4">
      <h1 className="text-lg font-medium">Create account</h1>
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
        {loading ? "Creating account..." : "Sign up"}
      </Button>
      <p className="text-sm text-fg-muted text-center">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-fg hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
