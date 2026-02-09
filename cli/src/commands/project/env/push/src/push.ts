/**
 * Push local environment variables to remote environment
 */

import chalk from "chalk";
import { setupEnvCommand, printNotImplemented } from "../../setup.js";

export interface PushOptions {
  environment?: string;
  prune?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

export async function pushCommand(options: PushOptions): Promise<void> {
  const environment = options.environment || "development";

  const context: [string, string][] = [["Env", environment]];
  if (options.prune) {
    context.push(["Prune", chalk.yellow("yes (will remove remote-only vars)")]);
  }
  if (options.dryRun) {
    context.push(["Mode", chalk.yellow("dry-run")]);
  }

  const ctx = await setupEnvCommand({
    command: "supa project env push",
    description: "Push local .env variables to remote environment.",
    json: options.json,
    profile: options.profile,
    context,
  });
  if (!ctx) return;

  // TODO: Implement full push logic when API is available
  //
  // 1. Load local variables from supabase/.env using loadLocalEnvVars()
  // 2. Load remote variables using client.listEnvVariables(projectRef, environment)
  // 3. Compute diff using computeEnvDiff(local, remote, { prune })
  // 4. If no changes, exit early with "No changes detected"
  // 5. For new variables without # @secret annotation:
  //    - Prompt "Mark as secret? [Y/n]" (default yes if isSensitiveKey())
  // 6. Format and display diff using formatEnvDiff()
  // 7. If --dry-run, stop here
  // 8. Prompt for confirmation unless --yes
  // 9. Call client.bulkUpsertEnvVariables(projectRef, environment, { variables, prune })

  printNotImplemented();
}
