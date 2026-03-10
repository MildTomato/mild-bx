/**
 * Create a custom environment
 */

import chalk from "chalk";
import { setupEnvCommand } from "../../setup.js";

export interface CreateOptions {
  name: string;
  from?: string;
  interactive?: boolean;
  json?: boolean;
  profile?: string;
}

export async function createCommand(options: CreateOptions): Promise<void> {
  const context: [string, string][] = [["Name", options.name]];
  if (options.from) {
    context.push(["From", options.from]);
  }

  const ctx = await setupEnvCommand({
    command: "supa project env create",
    description: "Create a custom environment.",
    json: options.json,
    profile: options.profile,
    context,
  });
  if (!ctx) return;

  // TODO: Implement full create logic when API is available
  if (options.json) {
    console.log(JSON.stringify({ status: "not_implemented", message: "Environment API not yet available" }));
  } else {
    console.log(chalk.yellow("  Environment API not yet available."));
  }
}
