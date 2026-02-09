/**
 * Seed one environment from another
 */

import { setupEnvCommand, printNotImplemented } from "../../setup.js";

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
  //
  // 1. Validate that target and from environments exist
  // 2. Fetch variables from source environment
  // 3. If --interactive, show list with checkboxes to select variables
  // 4. Show preview of what will be copied
  // 5. Prompt for confirmation unless --yes
  // 6. Call client.seedEnvironment(projectRef, target, { from, variables? })
  //
  // Notes:
  // - Secret values are copied (write-only to write-only)
  // - Existing variables in target are overwritten
  // - Branch overrides are NOT copied (only base values)

  printNotImplemented();
}
