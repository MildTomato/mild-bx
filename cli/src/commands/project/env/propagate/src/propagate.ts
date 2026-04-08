/**
 * Propagate environment variables to all healthy preview branches
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { setupEnvCommand } from "../../setup.js";
import { createClient } from "@/lib/api.js";
import { handleCommandError } from "@/lib/command-error.js";
import { listRemoteVariables } from "@/lib/env-api-bridge.js";
import { executePropagationPlan } from "@/lib/env-propagate.js";
import { buildPropagationPlan } from "@supabase-dx/env-vars";
import { createSpinner, setOutputMode } from "@/components/output.js";

const HEALTHY_STATUS = "ACTIVE_HEALTHY";

export interface PropagateOptions {
  branch?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

export async function propagateCommand(options: PropagateOptions): Promise<void> {
  setOutputMode(options);
  const context: [string, string][] = [];
  if (options.branch) {
    context.push(["Branch", options.branch]);
  }
  if (options.dryRun) {
    context.push(["Mode", chalk.yellow("dry-run")]);
  }

  const ctx = await setupEnvCommand({
    command: "supa project env propagate",
    description: "Propagate environment variables to preview branches.",
    json: options.json,
    profile: options.profile,
    context,
  });
  if (!ctx) return;

  const client = createClient(ctx.token);
  const spinner = createSpinner();
  spinner.start("Fetching variables and branches...");

  let allVars;
  let branches;
  try {
    [allVars, branches] = await Promise.all([
      listRemoteVariables( ctx.parentProjectRef),
      client.listBranches(ctx.parentProjectRef),
    ]);
  } catch (error) {
    spinner.stop(chalk.red("Failed"));
    await handleCommandError(error, options, client, ctx.projectRef);
    return;
  }

  let healthyBranches = branches.filter(
    (b) => b.preview_project_status === HEALTHY_STATUS && b.project_ref && b.persistent !== true
  );

  // Filter to specific branch if --branch is provided
  if (options.branch) {
    healthyBranches = healthyBranches.filter(
      (b) => b.git_branch === options.branch || b.name === options.branch
    );
  }

  spinner.stop("Fetched");

  if (healthyBranches.length === 0) {
    const msg = options.branch
      ? `No healthy preview branch found matching "${options.branch}"`
      : "No healthy preview branches found";

    if (options.json) {
      console.log(JSON.stringify({ status: "success", message: msg, propagated: 0, skipped: branches.length }));
    } else {
      p.log.warn(msg);
    }
    return;
  }

  const plan = buildPropagationPlan(
    allVars.map((v) => ({ name: v.key, value: v.value ?? "" })),
    healthyBranches.map((b) => ({ project_ref: b.project_ref!, git_branch: b.git_branch ?? "" })),
  );

  // Show what will be pushed
  if (!options.json) {
    console.log();
    console.log(chalk.dim(`Will propagate to ${healthyBranches.length} branch(es):`));
    for (const { gitBranch, vars } of plan) {
      console.log(`  ${chalk.cyan(gitBranch || "(unnamed)")}  ${chalk.dim(`${vars.length} variable(s)`)}`);
    }
    console.log();
  }

  if (options.dryRun) {
    if (options.json) {
      console.log(JSON.stringify({
        status: "dry_run",
        branches: plan.map(({ branchRef, gitBranch, vars }) => ({
          branchRef,
          gitBranch,
          varCount: vars.length,
        })),
      }));
    } else {
      console.log(chalk.yellow("(dry-run — no changes applied)"));
    }
    return;
  }

  // Confirm unless --yes
  if (!options.yes && !options.json && process.stdout.isTTY) {
    const proceed = await p.confirm({
      message: `Propagate to ${healthyBranches.length} branch(es)?`,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled");
      return;
    }
  }

  // Execute propagation
  const pushSpinner = createSpinner();
  pushSpinner.start("Propagating...");

  try {
    const { propagated, errors } = await executePropagationPlan(client, plan);
    const skipped = branches.length - healthyBranches.length;

    pushSpinner.stop(
      `Propagated to ${propagated} branch(es)${skipped > 0 ? `, skipped ${skipped}` : ""}${errors.length > 0 ? ` (${errors.length} error(s))` : ""}`
    );

    if (errors.length > 0) {
      for (const err of errors) {
        if (options.json) {
          console.error(JSON.stringify({ status: "error", message: err }));
        } else {
          p.log.warn(`Error: ${err}`);
        }
      }
    }

    if (options.json) {
      console.log(JSON.stringify({
        status: "success",
        propagated,
        skipped,
        errors,
      }));
    }
  } catch (error) {
    pushSpinner.stop(chalk.red("Failed"));
    await handleCommandError(error, options, client, ctx.projectRef);
  }
}
