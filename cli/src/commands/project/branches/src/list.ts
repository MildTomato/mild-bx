import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { printCommandHeader, S_BAR } from "@/components/command-header.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";
import { createSpinner, setOutputMode } from "@/components/output.js";

export interface ListBranchesOptions {
  json?: boolean;
  profile?: string;
}

export async function listBranches(options: ListBranchesOptions = {}): Promise<void> {
  const isTTY = process.stdout.isTTY && !options.json;
  const spinner = createSpinner();

  if (isTTY) {
    printCommandHeader({
      command: "supa project branches list",
      description: ["List all database branches for this project."],
    });
    console.log(S_BAR);
  }

  const { projectRef, token: authToken } = await resolveProjectContext({
    ...options,
    skipBranchResolution: true,
  });
  const client = createClient(authToken);

  spinner.start("Fetching branches…");

  try {
    const branches = await client.listBranches(projectRef);

    spinner.stop(`Found ${branches.length} branch${branches.length === 1 ? "" : "es"}`);

    if (options.json) {
      console.log(JSON.stringify({ branches: branches.map((b) => ({ ...b })) }));
      return;
    }

    if (isTTY) {
      if (branches.length === 0) {
        console.log(`${S_BAR}  ${chalk.dim("No branches found.")}`);
        console.log(S_BAR);
        console.log();
        return;
      }

      // Calculate column widths based on data
      const nameWidth = Math.max(4, ...branches.map((b) => b.name.length));
      const statusWidth = Math.max(6, ...branches.map((b) => b.status.length));
      const gitWidth = Math.max(10, ...branches.map((b) => (b.git_branch ?? "—").length));
      const refWidth = Math.max(11, ...branches.map((b) => b.project_ref.length));

      // Header row
      const header = [
        chalk.bold("Name").padEnd(nameWidth),
        chalk.bold("Status").padEnd(statusWidth),
        chalk.bold("Git Branch").padEnd(gitWidth),
        chalk.bold("Project Ref").padEnd(refWidth),
      ].join("  ");

      console.log(`${S_BAR}  ${header}`);
      console.log(
        `${S_BAR}  ${chalk.dim("─".repeat(nameWidth + statusWidth + gitWidth + refWidth + 6))}`
      );

      for (const branch of branches) {
        const namePadded = chalk.cyan(branch.name.padEnd(nameWidth));
        const defaultBadge = branch.is_default ? " " + chalk.green("(default)") : "";

        const statusColor =
          branch.status === "MIGRATIONS_PASSED" || branch.status === "FUNCTIONS_DEPLOYED"
            ? chalk.green
            : branch.status === "MIGRATIONS_FAILED" || branch.status === "FUNCTIONS_FAILED"
              ? chalk.red
              : chalk.yellow;
        const statusPadded = statusColor(branch.status.padEnd(statusWidth));

        const gitPadded = branch.git_branch
          ? branch.git_branch.padEnd(gitWidth)
          : chalk.dim("—".padEnd(gitWidth));

        const refPadded = branch.project_ref.padEnd(refWidth);

        console.log(`${S_BAR}  ${namePadded}${defaultBadge}  ${statusPadded}  ${gitPadded}  ${refPadded}`);
      }

      console.log(S_BAR);
      console.log(`${chalk.dim("└")}`);
      console.log();
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
      p.log.error(`Failed to list branches: ${msg}`);
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
