/**
 * Pull environment variables from remote to local .env file
 */

import { setupEnvCommand, printNotImplemented } from "../../setup.js";

export interface PullOptions {
  environment?: string;
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

export async function pullCommand(options: PullOptions): Promise<void> {
  const environment = options.environment || "development";

  const ctx = await setupEnvCommand({
    command: "supa project env pull",
    description: "Pull remote environment variables to .env file.",
    json: options.json,
    profile: options.profile,
    context: [["Env", environment]],
  });
  if (!ctx) return;

  // TODO: Implement full pull logic when API is available
  //
  // const client = createClient(ctx.token);
  // const variables = await client.listEnvVariables(ctx.projectRef, environment, { decrypt: false });
  // const nonSecret = variables.filter(v => !v.secret);
  // const secrets = variables.filter(v => v.secret);
  // writeEnvFile(ctx.cwd, nonSecret, `# Pulled from ${environment}`);
  //
  // Security notes:
  // - Secret variables are NEVER included in pulled .env file
  // - Footer comment lists excluded secret keys for reference
  // - Users can manually add secrets to .env.local if needed locally

  printNotImplemented();
}
