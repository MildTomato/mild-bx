import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { parseEnvFile } from "./env-file.js";
import { isBranchingProfile } from "./workflow-profiles.js";
import { getWorkflowProfile } from "./config.js";
import type { ProjectConfig } from "./config-types.js";

export interface EnvBranchCheckResult {
  ok: boolean;
  gitBranch: string;
  envProjectRef: string | null;
  expectedProjectRef: string | null;
  message: string;
}

/**
 * Check that SUPABASE_URL in .env.local matches the expected project ref
 * for the current git branch. Non-blocking — always resolves.
 *
 * @param cwd - project root
 * @param gitBranch - current git branch name
 * @param resolvedProjectRef - the project ref resolved by resolveProjectContext
 * @param config - loaded project config
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
  const envLocalPath = path.join(cwd, ".env.local");
  if (!fs.existsSync(envLocalPath)) return;

  const content = fs.readFileSync(envLocalPath, "utf-8");
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
      }) + "\n"
    );
  } else {
    process.stderr.write(
      chalk.yellow("⚠ ") + chalk.yellow("Env mismatch: ") +
      chalk.dim(`SUPABASE_URL points to ${chalk.bold(envProjectRef)} but git branch `) +
      chalk.cyan(gitBranch) +
      chalk.dim(` maps to ${chalk.bold(resolvedProjectRef)}`) +
      chalk.dim(" — run ") + chalk.cyan("`supa dev`") + chalk.dim(" to sync.\n")
    );
  }
}
