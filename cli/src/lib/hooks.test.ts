import { describe, it, expect } from "vitest";
import { getHookWatchSources } from "./hooks.js";

describe("getHookWatchSources", () => {
  const cwd = "/project";

  it("returns empty for undefined", () => {
    expect(getHookWatchSources(undefined, cwd)).toEqual([]);
  });

  it("returns empty for string hook with no watch", () => {
    expect(getHookWatchSources("npx drizzle-kit generate", cwd)).toEqual([]);
  });

  it("parses a plain directory watch path", () => {
    const sources = getHookWatchSources(
      { command: "echo hi", watch: "./supabase/drizzle" },
      cwd,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].dir).toBe("/project/supabase/drizzle");
    expect(sources[0].raw).toBe("./supabase/drizzle");
    // No glob — matches everything
    expect(sources[0].filter("/project/supabase/drizzle/schema.ts")).toBe(true);
    expect(sources[0].filter("/project/supabase/drizzle/nested/file.js")).toBe(true);
  });

  it("parses **/*.ts glob", () => {
    const sources = getHookWatchSources(
      { command: "echo hi", watch: "./supabase/drizzle/**/*.ts" },
      cwd,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].dir).toBe("/project/supabase/drizzle");

    // Should match .ts files at any depth
    expect(sources[0].filter("/project/supabase/drizzle/schema.ts")).toBe(true);
    expect(sources[0].filter("/project/supabase/drizzle/models/user.ts")).toBe(true);
    expect(sources[0].filter("/project/supabase/drizzle/deep/nested/file.ts")).toBe(true);

    // Should NOT match non-.ts files
    expect(sources[0].filter("/project/supabase/drizzle/readme.md")).toBe(false);
    expect(sources[0].filter("/project/supabase/drizzle/config.json")).toBe(false);

    // Should NOT match files outside the directory
    expect(sources[0].filter("/project/supabase/schema/public.sql")).toBe(false);
  });

  it("parses *.ts glob (single level)", () => {
    const sources = getHookWatchSources(
      { command: "echo hi", watch: "./src/*.ts" },
      cwd,
    );
    expect(sources[0].dir).toBe("/project/src");

    expect(sources[0].filter("/project/src/index.ts")).toBe(true);
    // picomatch: *.ts should NOT match nested
    expect(sources[0].filter("/project/src/nested/index.ts")).toBe(false);
  });

  it("parses {ts,tsx} brace expansion", () => {
    const sources = getHookWatchSources(
      { command: "echo hi", watch: "./src/**/*.{ts,tsx}" },
      cwd,
    );
    expect(sources[0].filter("/project/src/App.tsx")).toBe(true);
    expect(sources[0].filter("/project/src/lib/utils.ts")).toBe(true);
    expect(sources[0].filter("/project/src/style.css")).toBe(false);
  });

  it("handles array of hooks with mixed watch paths", () => {
    const sources = getHookWatchSources(
      [
        { command: "cmd1", watch: "./a/**/*.ts" },
        "cmd2-no-watch",
        { command: "cmd3", watch: "./b" },
      ],
      cwd,
    );
    expect(sources).toHaveLength(2);
    expect(sources[0].dir).toBe("/project/a");
    expect(sources[1].dir).toBe("/project/b");
  });
});
