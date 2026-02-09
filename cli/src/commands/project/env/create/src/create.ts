/**
 * Create a custom environment
 */

import { setupEnvCommand, printNotImplemented } from "../../setup.js";

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
  //
  // 1. Validate name (alphanumeric, hyphens, underscores only)
  // 2. Check name is not reserved (development/preview/production)
  // 3. If --interactive, prompt for --from if not provided
  // 4. Call client.createEnvironment(projectRef, { name, from? })

  printNotImplemented();
}
