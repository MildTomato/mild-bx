/**
 * Shared setup for all env subcommands.
 *
 * Handles the repeated pattern:
 *   1. JSON mode → resolve context, output stub, return null
 *   2. Interactive → requireTTY, resolve context, print header + context lines
 *
 * Returns ProjectContext for the caller to continue with business logic,
 * or null if JSON mode was fully handled.
 */

import chalk from "chalk";
import {
  resolveProjectContext,
  requireTTY,
  type ProjectContext,
} from "@/lib/resolve-project.js";
import { printCommandHeader } from "@/components/command-header.js";

export interface EnvCommandSetup {
  command: string;
  description: string;
  json?: boolean;
  profile?: string;
  context?: [label: string, value: string][];
}

/**
 * Set up an env subcommand. Handles JSON stub, TTY check, project resolution,
 * and prints the command header with context lines.
 *
 * Returns null if JSON mode was handled (caller should return early).
 * Returns ProjectContext if interactive mode is ready for business logic.
 */
export async function setupEnvCommand(
  options: EnvCommandSetup
): Promise<ProjectContext | null> {
  // JSON mode: resolve context, output stub, signal caller to return
  if (options.json) {
    await resolveProjectContext(options);
    // TODO: Remove this stub when API is available — each command
    // will handle its own JSON output after calling resolveProjectContext directly.
    console.log(
      JSON.stringify({
        status: "not_implemented",
        message: "Environment API not yet available",
      })
    );
    return null;
  }

  requireTTY();
  const ctx = await resolveProjectContext(options);

  const context: [string, string][] = [
    ["Project", ctx.projectRef],
    ["Profile", ctx.profile?.name || "default"],
    ...(options.context || []),
  ];

  printCommandHeader({
    command: options.command,
    description: [options.description],
    context,
  });

  return ctx;
}

/** Consistent stub message for unimplemented interactive commands */
export function printNotImplemented(): void {
  console.log(chalk.yellow("  Environment API not yet available."));
}
