"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <div className="flex gap-1 text-xs">
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
  );
}
