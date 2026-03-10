/**
 * Shared setup for all env subcommands.
 *
 * Handles the repeated pattern:
 *   1. Resolve project context
 *   2. Print command header with context lines (Project, Profile, Context)
 *
 * Works in all output modes — TTY, non-TTY (agent), and --json.
 * Only interactive prompts within commands should gate on isTTY.
 *
 * Returns ProjectContext for the caller to continue with business logic.
 */

import {
  resolveProjectContext,
  type ProjectContext,
} from "@/lib/resolve-project.js";
import { printCommandHeader } from "@/components/command-header.js";
import chalk from "chalk";

const PRODUCTION_BRANCHES = new Set(["main", "master", "production"]);

function branchContextLabel(branch: string): string {
  if (PRODUCTION_BRANCHES.has(branch)) return chalk.green("production");
  return `${chalk.cyan("preview")}  ${chalk.dim("·")}  ${chalk.dim(branch)}`;
}

export interface EnvCommandSetup {
  command: string;
  description: string;
  json?: boolean;
  profile?: string;
  context?: [label: string, value: string][];
}

/**
 * Set up an env subcommand. Resolves project context and prints the
 * command header with context lines.
 *
 * Works without a TTY — agents and scripts get the same output.
 * Use options.json for machine-readable output instead.
 */
export async function setupEnvCommand(
  options: EnvCommandSetup
): Promise<ProjectContext | null> {
  const ctx = await resolveProjectContext(options);

  if (options.json) {
    return ctx;
  }

  const context: [string, string][] = [
    ["Project", ctx.projectRef],
    ["Profile", ctx.profile?.name || "default"],
    ["Context", branchContextLabel(ctx.branch)],
    ...(options.context || []),
  ];

  printCommandHeader({
    command: options.command,
    description: [options.description],
    context,
  });

  return ctx;
}
