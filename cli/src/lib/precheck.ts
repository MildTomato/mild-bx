/**
 * Pre-command checks that run before every project command via resolveProjectContext.
 * Keeps generated artifacts in sync without the user having to think about it.
 */

import { statSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import chalk from "chalk";
import { runCodegen } from "./codegen/index.js";
import type { ProjectConfig } from "./config.js";
import type { CodegenConfig } from "@supabase-dx/config";

/**
 * Check whether codegen output files are stale relative to database.ts.
 * If stale (or missing), regenerate them silently.
 *
 * Called from resolveProjectContext so it runs before dev, push, pull, branches, etc.
 */
export function runCodegenIfStale(cwd: string, config: ProjectConfig): void {
  const codegenConfig = (config as Record<string, unknown>).codegen as CodegenConfig | undefined;
  if (!codegenConfig?.validation && !codegenConfig?.plugins?.length) return;

  const sourcePath = join(cwd, "supabase", "types", "database.ts");
  let sourceMtime: number;
  try {
    sourceMtime = statSync(sourcePath).mtimeMs;
  } catch {
    // database.ts doesn't exist yet — nothing to generate from
    return;
  }

  // Determine which output files are expected
  const expectedOutputs: string[] = [];
  if (codegenConfig.validation === "zod") expectedOutputs.push("supabase/types/schema.ts");
  if (codegenConfig.plugins?.includes("tanstack")) expectedOutputs.push("supabase/lib/db.ts");

  // Check if any output is missing or older than the source
  const needsRegen = expectedOutputs.some((rel) => {
    try {
      return statSync(join(cwd, rel)).mtimeMs < sourceMtime;
    } catch {
      return true; // file doesn't exist
    }
  });

  if (!needsRegen) return;

  try {
    const result = runCodegen(cwd, codegenConfig);
    for (const file of result.files) {
      const filePath = join(cwd, file.relativePath);
      mkdirSync(dirname(filePath), { recursive: true });

      let existing = "";
      try { existing = readFileSync(filePath, "utf-8"); } catch { /* new file */ }

      if (file.content !== existing) {
        writeFileSync(filePath, file.content);
        console.log(chalk.dim(`  Generated ${file.relativePath}`));
      }
    }
  } catch {
    // Non-fatal — don't block the command if codegen fails
  }
}
