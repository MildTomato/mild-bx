import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { getWorkflowProfile } from "@/lib/config.js";
import { printHeader } from "@/components/command-header.js";
import { createSpinner } from "@/components/output.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";
import { pollBranchUntilHealthy } from "./poll-branch.js";

export interface ResetBranchOptions {
  yes?: boolean;
  json?: boolean;
  profile?: string;
  verbose?: boolean;
}

export async function resetBranch(options: ResetBranchOptions = {}): Promise<void> {
  const isTTY = process.stdout.isTTY && !options.json;
  const spinner = createSpinner(options);

  const ctx = await resolveProjectContext({
    ...options,
    skipBranchResolution: false,
  });
  const { projectRef, parentProjectRef, token, isBranch, config } = ctx;

  if (!isBranch || !parentProjectRef) {
    if (options.json) {
      console.error(
        JSON.stringify({
          status: "error",
          message: "Not on a preview branch. Switch to a branch git branch first.",
          exitCode: EXIT_CODES.VALIDATION_ERROR,
        })
      );
    } else {
      p.log.error("Not on a preview branch. Switch to a branch git branch first.");
    }
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  const workflowProfile = getWorkflowProfile(config);
  if (workflowProfile !== "branching-remote") {
    // TODO: local workflow not yet supported
    if (options.json) {
      console.error(
        JSON.stringify({
          status: "error",
          message: `'supa branch reset' is only supported for the 'branching-remote' workflow profile (current: '${workflowProfile}').`,
          exitCode: EXIT_CODES.VALIDATION_ERROR,
        })
      );
    } else {
      p.log.error(
        `'supa branch reset' is only supported for the 'branching-remote' workflow profile (current: '${workflowProfile}').`
      );
    }
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  if (isTTY) {
    printHeader("supa project branches reset", "Wipe this preview branch and re-apply schema + seed.", ctx);
  }

  // Confirm unless --yes
  if (!options.yes && isTTY) {
    const proceed = await p.confirm({
      message: chalk.yellow("This will wipe all data on this branch. Continue?"),
      initialValue: false,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled");
      process.exit(EXIT_CODES.USER_CANCELLED);
    }
  }

  const client = createClient(token);

  spinner.start("Resetting…");

  try {
    await client.resetBranch(projectRef);
  } catch (error) {
    spinner.stop(chalk.red("Reset failed"));
    const msg = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(
        JSON.stringify({
          status: "error",
          message: msg,
          exitCode: EXIT_CODES.NETWORK_ERROR,
        })
      );
    } else {
      p.log.error(`Failed to reset branch: ${msg}`);
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }

  spinner.message("Waiting for branch to become healthy…");

  const healthy = await pollBranchUntilHealthy(projectRef, parentProjectRef, token, spinner, options.verbose);

  if (!healthy) {
    spinner.stop(chalk.yellow("Branch reset — but did not become healthy in time"));
    if (options.json) {
      console.error(
        JSON.stringify({
          status: "error",
          message: "Branch did not become healthy after reset.",
          exitCode: EXIT_CODES.NETWORK_ERROR,
        })
      );
    } else {
      p.log.warn("Branch did not become healthy after reset. Check the Supabase dashboard.");
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }

  spinner.stop(`Branch ${chalk.cyan(projectRef)} is healthy`);

  // Re-apply schema
  const { pushCommand } = await import("../../push/src/push.js");
  await pushCommand({ profile: options.profile, yes: true, json: options.json });

  // Re-apply seed
  const { seedCommand } = await import("../../seed/src/seed.js");
  await seedCommand({ profile: options.profile, json: options.json });

  if (isTTY) {
    console.log(`${chalk.dim("╰─")} Done`);
  }

  if (options.json) {
    console.log(JSON.stringify({ status: "success" }));
  }
}
