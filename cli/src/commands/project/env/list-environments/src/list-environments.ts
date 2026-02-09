/**
 * List all environments for the project
 */

import { setupEnvCommand, printNotImplemented } from "../../setup.js";

export interface ListEnvironmentsOptions {
  json?: boolean;
  profile?: string;
}

export async function listEnvironmentsCommand(
  options: ListEnvironmentsOptions
): Promise<void> {
  const ctx = await setupEnvCommand({
    command: "supa project env list-environments",
    description: "List all environments for the project.",
    json: options.json,
    profile: options.profile,
  });
  if (!ctx) return;

  // TODO: Implement full list-environments logic when API is available
  //
  // 1. Call client.listEnvironments(projectRef)
  // 2. Format output as table: NAME / DEFAULT / VARIABLES / CREATED
  // 3. Show default environments (development, preview, production) + custom

  printNotImplemented();
}
