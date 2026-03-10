import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { printCommandHeader, S_BAR } from "@/components/command-header.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";
import { createSpinner } from "@/components/output.js";

export interface UpdateBranchOptions {
  name?: string;
  "git-branch"?: string;
  persistent?: boolean;
  json?: boolean;
  profile?: string;
}

export async function updateBranch(
  nameOrId: string,
  options: UpdateBranchOptions = {}
): Promise<void> {
  const isTTY = process.stdout.isTTY && !options.json;
  const spinner = createSpinner(options);

  if (isTTY) {
    printCommandHeader({
      command: "supa branches update",
      description: ["Update an existing database branch."],
    });
    console.log(S_BAR);
  }

  // Validate that at least one update field is specified
  if (!options.name && !options["git-branch"] && options.persistent === undefined) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: "MissingFields",
          message: "Provide at least one of --name, --git-branch, or --persistent to update.",
          exitCode: EXIT_CODES.VALIDATION_ERROR,
        })
      );
    } else {
      p.log.error("Provide at least one field to update.");
      p.log.message(
        `  Options: ${chalk.cyan("--name <name>")}, ${chalk.cyan("--git-branch <branch>")}, ${chalk.cyan("--persistent")}`
      );
    }
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  const { projectRef, token: authToken } = await resolveProjectContext({ ...options, skipBranchResolution: true });
  const client = createClient(authToken);

  // Resolve name → branch ID by listing branches and matching
  spinner.start("Resolving branch...");

  let branchId: string;
  let resolvedName: string;

  try {
    const branches = await client.listBranches(projectRef);

    // Try to match by ID first, then by name (case-insensitive)
    const match =
      branches.find((b) => b.id === nameOrId) ??
      branches.find((b) => b.name.toLowerCase() === nameOrId.toLowerCase());

    if (!match) {
      spinner.stop("Branch not found");
      if (options.json) {
        console.error(
          JSON.stringify({
            error: "BranchNotFound",
            message: `No branch found matching: ${nameOrId}`,
            exitCode: EXIT_CODES.VALIDATION_ERROR,
          })
        );
      } else {
        p.log.error(`No branch found matching: ${chalk.cyan(nameOrId)}`);
        if (branches.length > 0) {
          p.log.message(
            `  Available branches: ${branches
              .map((b) => chalk.cyan(b.name))
              .join(", ")}`
          );
        }
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

  // Build update payload
  const body: {
    branch_name?: string;
    git_branch?: string;
    persistent?: boolean;
  } = {};

  if (options.name) body.branch_name = options.name;
  if (options["git-branch"]) body.git_branch = options["git-branch"];
  if (options.persistent !== undefined) body.persistent = options.persistent;

  spinner.start(`Updating branch ${chalk.cyan(resolvedName)}...`);

  try {
    const updated = await client.updateBranch(branchId, body);
    spinner.stop(`Branch updated`);

    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          branch: {
            id: updated.id,
            name: updated.name,
            project_ref: updated.project_ref,
            parent_project_ref: updated.parent_project_ref,
            persistent: updated.persistent,
            status: updated.status,
            git_branch: updated.git_branch,
            updated_at: updated.updated_at,
          },
        })
      );
    } else if (isTTY) {
      console.log(S_BAR);
      console.log(`${chalk.dim("└")}`);
      console.log();
      console.log(chalk.green("✓") + ` Branch ${chalk.cyan(updated.name)} updated successfully`);
      console.log();
      console.log(chalk.dim("  Current state:"));
      console.log(`  ${chalk.dim("•")} Name:     ${updated.name}`);
      console.log(`  ${chalk.dim("•")} ID:       ${updated.id}`);
      if (updated.git_branch) {
        console.log(`  ${chalk.dim("•")} Git:      ${updated.git_branch}`);
      }
      console.log(`  ${chalk.dim("•")} Persist:  ${updated.persistent ? "yes" : "no"}`);
      console.log(`  ${chalk.dim("•")} Status:   ${updated.status}`);
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
      p.log.error(`Failed to update branch: ${msg}`);
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }
}
