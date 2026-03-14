/**
 * Lifecycle hooks — run user-defined shell commands at specific points
 * in the supa workflow (e.g. pre_push, pre_pull).
 *
 * In `supa dev`, hooks participate in a chain-reaction model:
 *   1. A hook source file changes (e.g. a Drizzle schema file).
 *   2. The hook runs (e.g. `drizzle-kit generate` writes SQL to supabase/schema/).
 *   3. The schema file watcher picks up the generated SQL and triggers a push.
 *
 * This means hooks must complete before the schema watcher fires, which is
 * achieved by suppressing schema events while hooks are running.
 */

import { execSync, exec } from "node:child_process";
import { resolve } from "node:path";
import picomatch from "picomatch";
import type { HookDef } from "@supabase-dx/config";

interface NormalizedHook {
  command: string;
  watch?: string;
}

/**
 * Normalize a HookDef into a flat list of hook objects.
 * The config allows hooks to be a bare string, a single object, or an array
 * of either — this collapses all three forms into one consistent shape.
 */
function normalize(def: HookDef): NormalizedHook[] {
  const items = Array.isArray(def) ? def : [def];
  return items
    .map((item) =>
      typeof item === "string" ? { command: item } : item,
    )
    .filter((h) => h.command.trim());
}

/**
 * Run one or more hooks sequentially.
 * Throws on the first non-zero exit code.
 */
export function runHooks(
  def: HookDef | undefined,
  cwd: string,
  onLog?: (msg: string) => void,
): void {
  if (!def) return;

  for (const hook of normalize(def)) {
    onLog?.(`$ ${hook.command}`);
    try {
      execSync(hook.command, { cwd, shell: true, stdio: "pipe" });
      onLog?.(`✓ done`);
    } catch (err) {
      const stderr =
        err && typeof err === "object" && "stderr" in err
          ? (err as { stderr: Buffer }).stderr?.toString().trim()
          : "";
      const message = stderr || (err instanceof Error ? err.message : String(err));
      throw new Error(`Hook failed: ${hook.command}\n${message}`);
    }
  }
}

/**
 * Async variant of runHooks — uses child_process.exec instead of execSync.
 *
 * execSync blocks the Node event loop, which prevents the clack spinner from
 * animating while a hook is running. This async version keeps the event loop
 * alive so the spinner renders correctly during long-running hook commands.
 */
export async function runHooksAsync(
  def: HookDef | undefined,
  cwd: string,
  onLog?: (msg: string) => void,
): Promise<void> {
  if (!def) return;

  for (const hook of normalize(def)) {
    onLog?.(`$ ${hook.command}`);
    await new Promise<void>((resolve, reject) => {
      exec(hook.command, { cwd, shell: true }, (err, _stdout, stderr) => {
        if (err) {
          const message = stderr?.trim() || err.message;
          reject(new Error(`Hook failed: ${hook.command}\n${message}`));
        } else {
          resolve();
        }
      });
    });
  }
}

export interface HookWatchSource {
  /** Absolute directory path to watch. */
  dir: string;
  /** Original glob/path from config (for display). */
  raw: string;
  /** Filter function — returns true if a file path matches the glob. */
  filter: (filePath: string) => boolean;
}

/**
 * Split a glob pattern into a concrete base directory and the glob remainder.
 * e.g. "./supabase/drizzle/**\/*.ts" → dir="./supabase/drizzle", glob="**\/*.ts"
 *
 * Chokidar v5 dropped built-in glob support, so we must give it a plain
 * directory path and handle glob matching ourselves (via picomatch in
 * parseWatchGlob). This function extracts the static directory prefix that
 * chokidar can watch.
 */
function splitGlob(pattern: string): { base: string; glob: string | null } {
  const parts = pattern.split("/");
  const baseParts: string[] = [];

  for (const part of parts) {
    if (part.includes("*") || part.includes("?") || part.includes("{")) break;
    baseParts.push(part);
  }

  const base = baseParts.join("/") || ".";
  const rest = parts.slice(baseParts.length).join("/");
  return { base, glob: rest || null };
}

/**
 * Parse a glob pattern into a watch source for chokidar.
 *
 * Because chokidar v5 doesn't accept globs, we watch the static base directory
 * and attach a picomatch filter. The filter receives every file event from that
 * directory and returns true only for paths that match the original glob's
 * remainder — effectively reimplementing glob filtering at the event level.
 */
function parseWatchGlob(pattern: string, cwd: string): HookWatchSource {
  const { base, glob } = splitGlob(pattern);
  const dir = resolve(cwd, base);

  if (!glob) {
    return { dir, raw: pattern, filter: () => true };
  }

  const isMatch = picomatch(glob);

  return {
    dir,
    raw: pattern,
    filter: (filePath: string) => {
      if (!filePath.startsWith(dir)) return false;
      const rel = filePath.slice(dir.length + 1);
      return isMatch(rel);
    },
  };
}

/**
 * Extract watch sources from a HookDef.
 * Each source has a directory to watch and a filter for glob matching.
 */
export function getHookWatchSources(def: HookDef | undefined, cwd: string): HookWatchSource[] {
  if (!def) return [];
  return normalize(def)
    .map((h) => h.watch)
    .filter((w): w is string => !!w)
    .map((w) => parseWatchGlob(w, cwd));
}
