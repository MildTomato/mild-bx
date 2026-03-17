import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { printHeader, S_BAR } from "@/components/command-header.js";
import { getCurrentBranch } from "@/lib/git.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";
import { writeBranchEnv } from "@/lib/env-file.js";
import type { CreateBranchBody } from "@/lib/api.js";
import { createSpinner } from "@/components/output.js";
import { pollBranchUntilHealthy } from "./poll-branch.js";

export interface CreateBranchOptions {
  persistent?: boolean;
  "with-data"?: boolean;
  "git-branch"?: string;
  noPush?: boolean;
  json?: boolean;
  yes?: boolean;
  profile?: string;
}

export async function createBranch(
  nameArg: string | undefined,
  options: CreateBranchOptions = {}
): Promise<void> {
  const isTTY = process.stdout.isTTY && !options.json;
  const spinner = createSpinner(options);

  const ctx = await resolveProjectContext({ ...options, skipBranchResolution: true });
  const { projectRef, token: authToken } = ctx;

  if (isTTY) {
    printHeader("supa project branches create", "Create a new database branch.", ctx);
  }
  const client = createClient(authToken);

  // Check for an existing branch matching the current git branch before prompting
  const cwd = process.cwd();
  const gitBranch = getCurrentBranch(cwd);

  if (gitBranch && !nameArg) {
    try {
      const existingBranches = await client.listBranches(projectRef);
      const existingMatch = existingBranches.find(
        (b) => b.git_branch === gitBranch || b.name === gitBranch
      );

      if (existingMatch) {
        if (options.json || options.yes) {
          console.error(
            JSON.stringify({
              error: "BranchAlreadyExists",
              branch: {
                id: existingMatch.id,
                name: existingMatch.name,
                project_ref: existingMatch.project_ref,
                status: existingMatch.status,
                git_branch: existingMatch.git_branch,
              },
            })
          );
          process.exit(EXIT_CODES.VALIDATION_ERROR);
        } else if (isTTY) {
          console.log(
            `${S_BAR}  ${chalk.yellow("A preview branch already exists for this git branch:")}`
          );
          console.log(`${S_BAR}    ${chalk.dim("Name:")}   ${chalk.cyan(existingMatch.name)}`);
          console.log(`${S_BAR}    ${chalk.dim("Ref:")}    ${existingMatch.project_ref}`);
          console.log(`${S_BAR}    ${chalk.dim("Status:")} ${existingMatch.status}`);
          console.log(S_BAR);
          console.log();

          const createAnother = await p.confirm({
            message: "Create another branch with a different name?",
            initialValue: false,
          });

          if (p.isCancel(createAnother) || !createAnother) {
            p.cancel("Cancelled");
            process.exit(0);
          }

          const customName = await p.text({
            message: "Enter a name for the new branch:",
            validate: (v) => (v.trim() ? undefined : "Name cannot be empty"),
          });

          if (p.isCancel(customName)) {
            p.cancel("Cancelled");
            process.exit(EXIT_CODES.USER_CANCELLED);
          }

          nameArg = (customName as string).trim();
        } else {
          // Non-TTY, non-JSON, non-yes: treat as already-exists error
          console.error(`Branch already exists for git branch "${gitBranch}": ${existingMatch.name}`);
          process.exit(EXIT_CODES.VALIDATION_ERROR);
        }
      }
    } catch {
      // If the lookup fails (e.g. branching not enabled), continue to the create flow
    }
  }

  // Resolve branch name
  let branchName = nameArg;

  if (!branchName) {
    if (!gitBranch) {
      if (options.json) {
        console.error(
          JSON.stringify({
            error: "MissingBranchName",
            message: "No branch name provided and could not detect current git branch.",
            exitCode: EXIT_CODES.VALIDATION_ERROR,
          })
        );
      } else {
        p.log.error("No branch name provided and could not detect current git branch.");
        p.log.message(`  Provide a name: ${chalk.cyan("supa project branches create <name>")}`);
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    if (isTTY && !options.yes) {
      console.log(`${S_BAR}  ${chalk.dim("You're on git branch")} ${chalk.cyan(gitBranch)}.`);
      console.log(
        `${S_BAR}  ${chalk.dim("No Supabase preview branch exists for this git branch — creating one.")}`
      );
      console.log(S_BAR);

      const useDetected = await p.confirm({
        message: `Create a preview branch named ${chalk.cyan(gitBranch)}?`,
        initialValue: true,
      });

      if (p.isCancel(useDetected)) {
        p.cancel("Cancelled");
        process.exit(EXIT_CODES.USER_CANCELLED);
      }

      if (!useDetected) {
        const customName = await p.text({
          message: "Enter a name for the preview branch:",
          placeholder: gitBranch,
          validate: (v) => (v.trim() ? undefined : "Name cannot be empty"),
        });

        if (p.isCancel(customName)) {
          p.cancel("Cancelled");
          process.exit(EXIT_CODES.USER_CANCELLED);
        }

        branchName = (customName as string).trim();
      } else {
        branchName = gitBranch;
      }
    } else {
      branchName = gitBranch;
      if (isTTY) {
        console.log(
          `${S_BAR}  ${chalk.dim("Using current git branch:")} ${chalk.cyan(branchName)}`
        );
        console.log(S_BAR);
      }
    }
  } else if (isTTY && !options.yes) {
    const details: string[] = [`Branch name: ${chalk.cyan(branchName)}`];
    if (options.persistent) details.push("Persistent: yes");
    if (options["with-data"]) details.push("With data: yes");
    if (options["git-branch"]) details.push(`Git branch: ${chalk.cyan(options["git-branch"])}`);

    console.log(`${S_BAR}  ${chalk.dim("Details:")}`);
    for (const line of details) {
      console.log(`${S_BAR}    ${chalk.dim("•")} ${line}`);
    }
    console.log(S_BAR);

    const proceed = await p.confirm({
      message: `Create branch ${chalk.cyan(branchName)}?`,
      initialValue: true,
    });

    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled");
      process.exit(EXIT_CODES.USER_CANCELLED);
    }
  }

  spinner.start(`Creating branch ${chalk.cyan(branchName!)}…`);

  try {
    const body: CreateBranchBody = { branch_name: branchName!, is_default: false };

    if (options.persistent) body.persistent = true;
    if (options["with-data"]) body.with_data = true;
    // Associate with git branch: explicit flag > detected git branch
    const gitBranchToLink = options["git-branch"] ?? gitBranch ?? undefined;
    if (gitBranchToLink) body.git_branch = gitBranchToLink;

    const branch = await client.createBranch(projectRef, body);

    spinner.message(`Branch ${chalk.cyan(branch.name)} created — waiting for it to become healthy…`);

    const healthy = await pollBranchUntilHealthy(branch.project_ref, projectRef, authToken, spinner);

    if (healthy) {
      // Brief grace period to allow the branch project record to fully propagate
      // before any subsequent API calls (e.g. GET /v1/projects/{ref}).
      spinner.message("Waiting for branch to finish provisioning…");
      await new Promise((r) => setTimeout(r, 5000));
      spinner.stop(`Branch ${chalk.cyan(branch.name)} is ready`);
    } else {
      spinner.stop(chalk.yellow(`Branch ${chalk.cyan(branch.name)} created (still starting up)`));
    }

    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          branch: {
            id: branch.id,
            name: branch.name,
            project_ref: branch.project_ref,
            parent_project_ref: branch.parent_project_ref,
            persistent: branch.persistent,
            status: branch.status,
            git_branch: branch.git_branch,
            with_data: branch.with_data,
            created_at: branch.created_at,
          },
          healthy,
        })
      );
    } else if (isTTY) {
      console.log(S_BAR);
      console.log(`${chalk.dim("└")}`);
      console.log();
      if (healthy) {
        console.log(chalk.green("✓") + ` Branch ${chalk.cyan(branch.name)} is ready`);
      } else {
        console.log(
          chalk.yellow("⚠") + ` Branch ${chalk.cyan(branch.name)} created — still starting up`
        );
        console.log();
        console.log(
          chalk.dim("  The branch is provisioning. It should be ready in a few minutes.")
        );
      }
      console.log();
      console.log(chalk.dim("  Details:"));
      console.log(`  ${chalk.dim("•")} ID:       ${branch.id}`);
      console.log(`  ${chalk.dim("•")} Ref:      ${branch.project_ref}`);
      if (branch.git_branch) {
        console.log(`  ${chalk.dim("•")} Git:      ${branch.git_branch}`);
      }
      console.log(`  ${chalk.dim("•")} Persist:  ${branch.persistent ? "yes" : "no"}`);
      console.log();
    }

    // Write branch credentials to .env.local and inject the password into
    // process.env so the subsequent push picks up the right DB password.
    if (healthy) {
      try {
        const dbPass = await writeBranchEnv({
          cwd,
          projectRef: branch.project_ref,
          branchId: branch.id,
          token: authToken,
        });
        process.env.SUPABASE_DB_PASSWORD = dbPass;
      } catch {
        // Non-fatal — the push may still work if a password is already set
      }
    }

    // Push to the new branch once healthy (default) unless --no-push is set
    if (healthy && !options.noPush) {
      if (isTTY) {
        console.log("Pushing local schema and config…");
      }
      const { pushCommand } = await import("../../push/src/push.js");
      // resolveProjectContext will now route to the new branch automatically
      // because it matches the current git branch via listBranches
      await pushCommand({
        profile: options.profile,
        yes: true,
        json: options.json,
      });
    }

    // Propagate env vars to the new preview branch (non-fatal)
    if (healthy) {
      try {
        const { propagateToPreviewBranches } = await import("@/lib/env-propagate.js");
        await propagateToPreviewBranches({ client, projectRef });
      } catch {
        // non-fatal — branch was created successfully
      }
    }
  } catch (error) {
    spinner.stop(chalk.red("Failed"));
    const msg = error instanceof Error ? error.message : String(error);
    const isUnauthorized = msg === "Unauthorized";
    if (options.json) {
      console.error(
        JSON.stringify({
          error: isUnauthorized ? "Unauthorized" : "NetworkError",
          message: isUnauthorized
            ? "Unauthorized — your token may be expired (run `supa login`) or branching may not be enabled for this project."
            : msg,
          exitCode: EXIT_CODES.NETWORK_ERROR,
        })
      );
    } else {
      p.log.error(`Failed to create branch: ${msg}`);
      if (isUnauthorized) {
        p.log.message(
          chalk.dim(
            "  Hint: your token may be expired (run `supa login`) or branching may not be enabled for this project."
          )
        );
      }
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }
}
