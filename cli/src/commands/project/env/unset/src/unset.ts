/**
 * Delete an environment variable
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { setupEnvCommand } from "../../setup.js";
import { createClient } from "@/lib/api.js";
import { handleCommandError } from "@/lib/command-error.js";
import { deleteRemoteVariable } from "@/lib/env-api-bridge.js";
import { scopedVarName, type Scope } from "@supabase-dx/env-vars";
import { createSpinner, setOutputMode } from "@/components/output.js";

export interface UnsetOptions {
  key: string;
  scope?: Scope;
  branch?: string;
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

export async function unsetCommand(options: UnsetOptions): Promise<void> {
  setOutputMode(options);
  const scope = options.scope ?? "production";

  if (scope === "branch" && !options.branch) {
    console.error("Error: --branch is required when --scope is 'branch'");
    process.exit(1);
  }

  const storedKey = scopedVarName(options.key, scope, options.branch);

  const scopeLabel = scope === "branch"
    ? `branch:${options.branch}`
    : scope;

  const ctx = await setupEnvCommand({
    command: "supa project env unset",
    description: "Delete an environment variable.",
    json: options.json,
    profile: options.profile,
    context: [
      ["Key", storedKey],
      ["Scope", scopeLabel],
    ],
  });
  if (!ctx) return;

  // Confirm unless --yes
  if (!options.yes && process.stdout.isTTY && !options.json) {
    const proceed = await p.confirm({
      message: `Delete ${storedKey} (scope: ${scopeLabel})?`,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled");
      return;
    }
  }

  // Delete from remote
  const client = createClient(ctx.token);
  const spinner = createSpinner();
  spinner.start(`Deleting ${storedKey}...`);

  try {
    await deleteRemoteVariable( ctx.parentProjectRef, storedKey);
    spinner.stop(`Deleted ${chalk.cyan(storedKey)} (scope: ${scopeLabel})`);

    if (scope === "preview") {
      const { propagateToPreviewBranches } = await import("@/lib/env-propagate.js");
      await propagateToPreviewBranches({ client, projectRef: ctx.parentProjectRef });
    }

    if (options.json) {
      console.log(JSON.stringify({
        status: "success",
        key: options.key,
        storedKey,
        scope: scopeLabel,
      }));
    }
  } catch (error) {
    spinner.stop(chalk.red("Failed"));
    await handleCommandError(error, options, client, ctx.projectRef);
  }
}
