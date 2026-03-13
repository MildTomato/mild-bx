/**
 * Pre-command checks that run before every project command via resolveProjectContext.
 * Keeps generated artifacts in sync without the user having to think about it.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import chalk from "chalk";
import { parseEnvFile } from "./env-file.js";
import { isBranchingProfile } from "./workflow-profiles.js";
import { getWorkflowProfile } from "./config.js";
import { runCodegen } from "./codegen/index.js";
import type { ProjectConfig } from "./config.js";
import type { CodegenConfig } from "@supabase-dx/config";

/**
 * Check whether codegen output files are stale relative to database.ts.
 * If stale (or missing), regenerates them.
 *
 * Returns the relative paths of files that were written.
 * Called from resolveProjectContext so it runs before dev, push, pull, branches, etc.
 */
export function runCodegenIfStale(
  cwd: string,
  config: ProjectConfig,
  onGenerated?: (file: string) => void,
  onLog?: (msg: string) => void,
): string[] {
  const codegenConfig = (config as Record<string, unknown>).codegen as CodegenConfig | undefined;
  if (!codegenConfig?.validation && !codegenConfig?.plugins?.length) return [];

  const sourcePath = join(cwd, "supabase", "types", "database.ts");
  if (!existsSync(sourcePath)) return [];

  const parts: string[] = [];
  if (codegenConfig.validation) parts.push(`validation=${codegenConfig.validation}`);
  if (codegenConfig.plugins?.length) parts.push(`plugins=[${codegenConfig.plugins.join(", ")}]`);
  onLog?.(`codegen: detected ${parts.join(", ")}`);
  onLog?.(`codegen: generating files…`);

  try {
    const result = runCodegen(cwd, codegenConfig);
    onLog?.(`codegen: ${result.files.length} file(s) to check`);
    const generated: string[] = [];
    for (const file of result.files) {
      const filePath = join(cwd, file.relativePath);
      mkdirSync(dirname(filePath), { recursive: true });

      let existing = "";
      try { existing = readFileSync(filePath, "utf-8"); } catch { /* new file */ }

      if (file.content !== existing) {
        writeFileSync(filePath, file.content);
        generated.push(file.relativePath);
        onGenerated?.(file.relativePath);
      } else {
        onLog?.(`codegen: ${file.relativePath} up to date`);
      }
    }
    return generated;
  } catch (err) {
    onLog?.(`codegen: failed — ${err instanceof Error ? err.message : String(err)}`);
    // Non-fatal — don't block the command if codegen fails
    return [];
  }
}

/** Returns true if the error is a PostgREST schema cache not-ready error (PGRST002). */
function isSchemaNotReady(msg: string): boolean {
  // api.ts extracts json.message so we may get the human-readable string instead of the JSON;
  // match both the error code and the extracted message text.
  return msg.includes("PGRST002") || msg.includes("schema cache");
}

/**
 * Fetch TypeScript types (with PGRST002 retry), write database.ts, and run codegen.
 * Returns whether types were refreshed, which codegen files were written, and any error.
 */
export async function refreshTypesAndCodegen(options: {
  /** Callback that calls client.getTypescriptTypes() — keeps precheck.ts free of API deps */
  getTypes: () => Promise<{ types: string }>;
  cwd: string;
  config: ProjectConfig;
  onGenerated?: (file: string) => void;
  /** Called for verbose diagnostic messages */
  onLog?: (msg: string) => void;
  /** Called before each retry with 1-based attempt number, delay in ms, and max retries */
  onRetry?: (attempt: number, delayMs: number, maxRetries: number) => void;
}): Promise<{ typesRefreshed: boolean; generated: string[]; error?: string }> {
  const { getTypes, cwd, config, onGenerated, onLog, onRetry } = options;
  const typesPath = join(cwd, "supabase", "types", "database.ts");
  const MAX_RETRIES = 10;
  const RETRY_DELAY_MS = 5000;

  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      onLog?.(`types: fetching TypeScript types…`);
      const resp = await getTypes();
      mkdirSync(dirname(typesPath), { recursive: true });
      writeFileSync(typesPath, resp.types);
      onLog?.(`types: wrote ${typesPath}`);
      const generated = runCodegenIfStale(cwd, config, onGenerated, onLog);
      return { typesRefreshed: true, generated };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (isSchemaNotReady(lastError) && attempt < MAX_RETRIES) {
        onRetry?.(attempt + 1, RETRY_DELAY_MS, MAX_RETRIES);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      return { typesRefreshed: false, generated: [], error: lastError };
    }
  }
  return { typesRefreshed: false, generated: [], error: lastError };
}

/**
 * Check that SUPABASE_URL in .env.local matches the expected project ref
 * for the current git branch. Non-blocking — always resolves.
 */
export function checkEnvMatchesBranch(options: {
  cwd: string;
  gitBranch: string;
  resolvedProjectRef: string;
  config: ProjectConfig;
  json?: boolean;
}): void {
  const { cwd, gitBranch, resolvedProjectRef, config, json } = options;

  // Only relevant for branching profiles
  if (!isBranchingProfile(getWorkflowProfile(config))) return;

  // Read SUPABASE_URL from .env.local
  const envLocalPath = join(cwd, ".env.local");
  if (!existsSync(envLocalPath)) return;

  const content = readFileSync(envLocalPath, "utf-8");
  const parsed = parseEnvFile(content);
  const supabaseUrlVar = parsed.variables.find((v) => v.key === "SUPABASE_URL");
  if (!supabaseUrlVar) return;

  // Extract project ref from URL: https://<ref>.<domain> → <ref>
  const match = supabaseUrlVar.value.match(/^https?:\/\/([^.]+)\./);
  const envProjectRef = match ? match[1] : null;
  if (!envProjectRef) return;

  // Compare
  if (envProjectRef === resolvedProjectRef) return;

  // Mismatch — warn
  const message = `SUPABASE_URL in .env.local points to ${envProjectRef} but git branch "${gitBranch}" maps to ${resolvedProjectRef}. Run \`supa dev\` to sync.`;

  if (json || !process.stderr.isTTY) {
    process.stderr.write(
      JSON.stringify({
        warning: "EnvBranchMismatch",
        message,
        gitBranch,
        envProjectRef,
        expectedProjectRef: resolvedProjectRef,
      }) + "\n",
    );
  } else {
    process.stderr.write(
      chalk.yellow("⚠ ") + chalk.yellow("Env mismatch: ") +
      chalk.dim(`SUPABASE_URL points to ${chalk.bold(envProjectRef)} but git branch `) +
      chalk.cyan(gitBranch) +
      chalk.dim(` maps to ${chalk.bold(resolvedProjectRef)}`) +
      chalk.dim(" — run ") + chalk.cyan("`supa dev`") + chalk.dim(" to sync.\n"),
    );
  }
}
