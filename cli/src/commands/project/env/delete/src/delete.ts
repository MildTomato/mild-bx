/**
 * Delete a custom environment
 */

import { setupEnvCommand, printNotImplemented } from "../../setup.js";

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
  //
  // 1. Check name is not reserved (development/preview/production)
  // 2. Fetch environment to verify existence and get variable count
  // 3. Prompt for confirmation unless --yes
  // 4. Call client.deleteEnvironment(projectRef, name)

  printNotImplemented();
}
