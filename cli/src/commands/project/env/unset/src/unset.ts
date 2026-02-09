/**
 * Delete an environment variable
 */

import { setupEnvCommand, printNotImplemented } from "../../setup.js";

export interface UnsetOptions {
  key: string;
  environment?: string;
  branch?: string;
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

export async function unsetCommand(options: UnsetOptions): Promise<void> {
  const environment = options.environment || "development";
  const target = options.branch
    ? `${environment} (branch: ${options.branch})`
    : environment;

  const ctx = await setupEnvCommand({
    command: "supa project env unset",
    description: "Delete an environment variable.",
    json: options.json,
    profile: options.profile,
    context: [
      ["Env", target],
      ["Key", options.key],
    ],
  });
  if (!ctx) return;

  // TODO: Implement full unset logic when API is available
  //
  // 1. Prompt for confirmation unless --yes
  // 2. Call client.deleteEnvVariable(projectRef, environment, key, { branch? })

  printNotImplemented();
}
