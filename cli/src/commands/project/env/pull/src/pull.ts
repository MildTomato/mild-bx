/**
 * Pull environment variables from remote to local .env file
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { setupEnvCommand } from "../../setup.js";
import { createClient } from "@/lib/api.js";
import { handleCommandError } from "@/lib/command-error.js";
import { writeEnvFile } from "@/lib/env-file.js";
import { listRemoteVariables } from "@/lib/env-api-bridge.js";
import {
  resolveScoped,
  SENTINEL_KEYS,
  type EnvironmentContext,
} from "@supabase-dx/env-vars";
import { createSpinner } from "@/components/output.js";

export interface PullOptions {
  environment?: "production" | "preview" | "development";
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

export async function pullCommand(options: PullOptions): Promise<void> {
  const environment = options.environment ?? "production";

  const ctx = await setupEnvCommand({
    command: "supa project env pull",
    description: "Pull remote environment variables to .env file.",
    json: options.json,
    profile: options.profile,
    context: [["Env", environment]],
  });
  if (!ctx) return;

  const context: EnvironmentContext =
    environment === "preview"
      ? { type: "preview", branch: ctx.branch }
      : { type: environment };

  const client = createClient(ctx.token);
  const spinner = createSpinner(options);
  spinner.start("Fetching remote variables...");

  let raw: Array<{ key: string; value: string; secret: boolean }>;
  try {
    raw = await listRemoteVariables( ctx.parentProjectRef);
  } catch (error) {
    spinner.stop(chalk.red("Failed"));
    await handleCommandError(error, options, client, ctx.projectRef);
  }

  // Resolve effective values for the requested environment context,
  // excluding sentinel keys (internal CLI/dashboard communication)
  const resolved = resolveScoped(
    raw.map((v) => ({ name: v.key, value: v.value })),
    context
  );

  // Build the variable list to write, skip sentinels and secrets
  const secretKeys = new Set(raw.filter((v) => v.secret).map((v) => v.key));
  const toWrite: Array<{ key: string; value: string; secret: boolean }> = [];
  const excludedSecrets: string[] = [];

  for (const [key, value] of resolved) {
    if (SENTINEL_KEYS.has(key)) continue;
    if (secretKeys.has(key)) {
      excludedSecrets.push(key);
      continue;
    }
    toWrite.push({ key, value, secret: false });
  }

  spinner.stop(`Resolved ${resolved.size} variable(s) for ${environment}`);

  if (toWrite.length === 0 && excludedSecrets.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ status: "success", message: "No variables to pull", variables: [] }));
    } else {
      p.log.info(`No variables for ${environment}`);
    }
    return;
  }

  const header = `# Pulled from ${environment} (${new Date().toISOString().slice(0, 10)})${
    excludedSecrets.length > 0
      ? `\n# Secrets excluded (${excludedSecrets.length}): ${excludedSecrets.join(", ")}`
      : ""
  }`;

  writeEnvFile(ctx.cwd, toWrite, header);

  if (options.json) {
    console.log(JSON.stringify({
      status: "success",
      environment,
      written: toWrite.length,
      secretsExcluded: excludedSecrets,
      file: "supabase/.env",
    }));
  } else {
    p.log.success(`Wrote ${toWrite.length} variable(s) to supabase/.env`);
    if (excludedSecrets.length > 0) {
      p.log.info(
        `${excludedSecrets.length} secret(s) excluded: ${chalk.dim(excludedSecrets.join(", "))}`
      );
      p.log.info(`Add secrets to ${chalk.cyan("supabase/.env.local")} if needed locally`);
    }
  }
}
