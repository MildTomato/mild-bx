/**
 * Delete a custom environment
 */

import chalk from "chalk";
import { setupEnvCommand } from "../../setup.js";

export interface DeleteOptions {
  name: string;
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

export async function deleteCommand(options: DeleteOptions): Promise<void> {
  const ctx = await setupEnvCommand({
    command: "supa project env delete",
    description: "Delete a custom environment.",
    json: options.json,
    profile: options.profile,
    context: [["Name", options.name]],
  });
  if (!ctx) return;

  // TODO: Implement full delete logic when API is available
  if (options.json) {
    console.log(JSON.stringify({ status: "not_implemented", message: "Environment API not yet available" }));
  } else {
    console.log(chalk.yellow("  Environment API not yet available."));
  }
}
