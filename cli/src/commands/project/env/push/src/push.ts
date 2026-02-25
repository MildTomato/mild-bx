/**
 * Push local environment variables to remote environment
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { setupEnvCommand } from "../../setup.js";
import { createClient } from "@/lib/api.js";
import { handleCommandError } from "@/lib/command-error.js";
import { loadLocalEnvVars } from "@/lib/env-file.js";
import { listRemoteVariables, bulkPushVariables, setRemoteVariable } from "@/lib/env-api-bridge.js";
import { computeEnvDiff, formatEnvDiff, hasChanges, getDiffSummary } from "@/lib/env-diff.js";
import { SENTINEL_CONFIG_SOURCE } from "@supabase-dx/env-vars";

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

  // 1. Load local variables from supabase/.env
  const localParsed = loadLocalEnvVars(ctx.cwd);

  // Filter out # @secret vars - secrets are never pushed from .env per spec
  const pushableVars = localParsed.variables.filter((v) => !v.secret);

  // 2. Load remote variables
  const client = createClient(ctx.token);
  const spinner = options.json ? null : p.spinner();
  spinner?.start("Comparing local and remote...");

  let remoteVars;
  try {
    remoteVars = await listRemoteVariables(client, ctx.projectRef);
  } catch (error) {
    spinner?.stop(chalk.red("Failed"));
    await handleCommandError(error, options, client, ctx.projectRef);
  }

  // 3. Compute diff
  const diffs = computeEnvDiff(pushableVars, remoteVars, { prune: options.prune });

  if (!hasChanges(diffs)) {
    spinner?.stop("No changes detected");
    if (options.json) {
      console.log(JSON.stringify({
        status: "success",
        message: "No changes detected",
        diffs: [],
      }));
    }
    return;
  }

  spinner?.stop("Diff computed");

  const summary = getDiffSummary(diffs);

  // 4. Show diff
  if (options.json) {
    console.log(JSON.stringify({
      status: options.dryRun ? "dry_run" : "pending",
      diffs,
      summary,
    }));
    if (options.dryRun) return;
  } else {
    console.log(formatEnvDiff(diffs));
    console.log();

    if (options.dryRun) {
      console.log(chalk.yellow("(dry-run - no changes applied)"));
      return;
    }
  }

  // 5. Confirm
  if (!options.yes && !options.json && process.stdout.isTTY) {
    const proceed = await p.confirm({
      message: `Push ${summary.additions + summary.changes} change(s)${summary.removals > 0 ? ` and remove ${summary.removals} variable(s)` : ""}?`,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled");
      return;
    }
  }

  // 6. Push
  const pushSpinner = options.json ? null : p.spinner();
  pushSpinner?.start("Pushing...");

  try {
    const result = await bulkPushVariables(client, ctx.projectRef, pushableVars, {
      prune: options.prune,
    });

    // Write sentinel so the dashboard knows this project is config-in-code
    const configSource = (ctx.config.config_source as string | undefined) ?? "code";
    await setRemoteVariable(client, ctx.projectRef, SENTINEL_CONFIG_SOURCE, configSource, false);

    pushSpinner?.stop(
      `Pushed ${result.pushed} variable(s)${result.deleted > 0 ? `, removed ${result.deleted}` : ""}`
    );

    if (options.json) {
      console.log(JSON.stringify({
        status: "success",
        pushed: result.pushed,
        deleted: result.deleted,
      }));
    }
  } catch (error) {
    pushSpinner?.stop(chalk.red("Failed"));
    await handleCommandError(error, options, client, ctx.projectRef);
  }
}
