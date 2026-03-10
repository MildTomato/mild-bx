/**
 * Seed one environment from another
 */

import chalk from "chalk";
import { setupEnvCommand } from "../../setup.js";

export interface SeedOptions {
  target: string;
  from: string;
  interactive?: boolean;
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

export async function seedCommand(options: SeedOptions): Promise<void> {
  const ctx = await setupEnvCommand({
    command: "supa project env seed",
    description: "Seed one environment from another.",
    json: options.json,
    profile: options.profile,
    context: [
      ["Target", options.target],
      ["From", options.from],
    ],
  });
  if (!ctx) return;

  // TODO: Implement full seed logic when API is available
  if (options.json) {
    console.log(JSON.stringify({ status: "not_implemented", message: "Environment API not yet available" }));
  } else {
    console.log(chalk.yellow("  Environment API not yet available."));
  }
}
