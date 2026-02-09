/**
 * List environment variables for an environment
 */

import { setupEnvCommand, printNotImplemented } from "../../setup.js";

export interface ListOptions {
  environment?: string;
  branch?: string;
  json?: boolean;
  profile?: string;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const environment = options.environment || "development";
  const target = options.branch
    ? `${environment} (branch: ${options.branch})`
    : environment;

  const ctx = await setupEnvCommand({
    command: "supa project env list",
    description: "List environment variables.",
    json: options.json,
    profile: options.profile,
    context: [["Env", target]],
  });
  if (!ctx) return;

  // TODO: Implement full list logic when API is available
  //
  // 1. Call client.listEnvVariables(projectRef, environment, { branch?, decrypt: false })
  // 2. Format output as table: KEY / VALUE columns
  // 3. Secret values displayed as [secret] - never the actual value

  printNotImplemented();
}
