import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { printCommandHeader, S_BAR } from "@/components/command-header.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";
import { searchSelect, cancelSymbol } from "@/components/search-select.js";
import { createSpinner } from "@/components/output.js";

export interface DeleteBranchOptions {
  force?: boolean;
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

export async function deleteBranch(
  nameOrId: string | undefined,
  options: DeleteBranchOptions = {}
): Promise<void> {
  const isTTY = process.stdout.isTTY && !options.json;
  const spinner = createSpinner(options);
  const force = options.force ?? true;

  if (isTTY) {
    printCommandHeader({
      command: "supa branches delete",
      description: ["Delete a database branch."],
    });
    console.log(S_BAR);
  }

  const { projectRef, token: authToken } = await resolveProjectContext({ ...options, skipBranchResolution: true });
  const client = createClient(authToken);

  // Resolve name → branch ID
  spinner.start("Fetching branches...");

  let branchId: string;
  let resolvedName: string;

  try {
    const branches = await client.listBranches(projectRef);
    const deletable = branches.filter((b) => !b.is_default);

    let match = nameOrId
      ? (branches.find((b) => b.id === nameOrId) ??
         branches.find((b) => b.name.toLowerCase() === nameOrId.toLowerCase()))
      : undefined;

    if (!match) {
      if (nameOrId) {
        // Arg given but not found
        spinner.stop("Branch not found");
        if (options.json) {
          console.error(JSON.stringify({
            error: "BranchNotFound",
            message: `No branch found matching: ${nameOrId}`,
            exitCode: EXIT_CODES.VALIDATION_ERROR,
          }));
        } else {
          p.log.error(`No branch found matching: ${chalk.cyan(nameOrId)}`);
          if (deletable.length > 0) {
            p.log.message(`  Available: ${deletable.map((b) => chalk.cyan(b.name)).join(", ")}`);
          }
        }
        process.exit(EXIT_CODES.VALIDATION_ERROR);
      }

      // No arg — require TTY to pick interactively
      if (!isTTY) {
        console.error(JSON.stringify({
          error: "MissingArgument",
          message: "Branch name or ID required in non-interactive mode",
          exitCode: EXIT_CODES.VALIDATION_ERROR,
        }));
        process.exit(EXIT_CODES.VALIDATION_ERROR);
      }

      if (deletable.length === 0) {
        spinner.stop("No branches to delete");
        p.log.warn("No preview branches found.");
        process.exit(0);
      }

      spinner.stop("Select a branch to delete");

      const selected = await searchSelect({
        message: "Which branch?",
        items: deletable.map((b) => ({
          value: b.id,
          label: b.name,
          hint: b.git_branch ?? undefined,
        })),
      });

      if (selected === cancelSymbol) {
        p.cancel("Cancelled");
        process.exit(EXIT_CODES.USER_CANCELLED);
      }

      match = deletable.find((b) => b.id === selected)!;
    } else {
      spinner.stop(`Resolved to branch ${chalk.cyan(match.name)}`);
    }

    // Guard: never delete the default branch
    if (match.is_default) {
      spinner.stop("Cannot delete default branch");
      if (options.json) {
        console.error(
          JSON.stringify({
            error: "DeleteDefaultBranch",
            message: `Cannot delete the default branch: ${match.name}`,
            exitCode: EXIT_CODES.VALIDATION_ERROR,
          })
        );
      } else {
        p.log.error(
          `Cannot delete the default branch: ${chalk.cyan(match.name)}`
        );
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    branchId = match.id;
    resolvedName = match.name;
    spinner.stop(`Resolved to branch ${chalk.cyan(resolvedName)}`);
  } catch (error) {
    spinner.stop(chalk.red("Failed to list branches"));
    const msg = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(
        JSON.stringify({
          error: "NetworkError",
          message: msg,
          exitCode: EXIT_CODES.NETWORK_ERROR,
        })
      );
    } else {
      p.log.error(`Failed to list branches: ${msg}`);
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }

  // Confirm unless --yes
  if (!options.yes && isTTY) {
    const modeNote = force
      ? chalk.red("This will delete the branch immediately.")
      : chalk.yellow("The branch will be scheduled for deletion (1-hour grace period).");

    console.log(`${S_BAR}  ${modeNote}`);
    console.log(S_BAR);

    const proceed = await p.confirm({
      message: `Delete branch ${chalk.cyan(resolvedName)}?`,
      initialValue: false,
    });

    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled");
      process.exit(EXIT_CODES.USER_CANCELLED);
    }
  }

  spinner.start(`Deleting branch ${chalk.cyan(resolvedName)}...`);

  try {
    await client.deleteBranch(branchId, force);
    spinner.stop(`Branch ${chalk.cyan(resolvedName)} deleted`);

    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          branch: { id: branchId, name: resolvedName },
          force,
        })
      );
    } else if (isTTY) {
      console.log(S_BAR);
      console.log(`${chalk.dim("└")}`);
      console.log();
      console.log(chalk.green("✓") + ` Branch ${chalk.cyan(resolvedName)} deleted`);
      if (!force) {
        console.log();
        console.log(
          chalk.dim("  The branch has been scheduled for deletion with a 1-hour grace period.")
        );
      }
      console.log();
    }
  } catch (error) {
    spinner.stop(chalk.red("Failed"));
    const msg = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(
        JSON.stringify({
          error: "NetworkError",
          message: msg,
          exitCode: EXIT_CODES.NETWORK_ERROR,
        })
      );
    } else {
      p.log.error(`Failed to delete branch: ${msg}`);
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }
}
