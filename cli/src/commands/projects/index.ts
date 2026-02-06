/**
 * Projects command handler
 */

import arg from "arg";
import { projectsCommand, projectsListSubcommand, projectsNewSubcommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { projectsCommand as projectsHandler } from "./src/projects.js";

export { projectsCommand };

export default async function projects(argv: string[]): Promise<number> {
  // Parse subcommand first
  const [subcommand, ...rest] = argv;

  // Handle help for main command
  if (subcommand === "--help" || subcommand === "-h" || !subcommand) {
    renderHelp(projectsCommand);
    return 0;
  }

  // Route to subcommand
  if (subcommand === "list") {
    return handleList(rest);
  }

  if (subcommand === "new" || subcommand === "create") {
    return handleNew(rest);
  }

  // Unknown subcommand - treat as list (default)
  return handleList(argv);
}

async function handleList(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...projectsListSubcommand.options, ...globalCommandOptions]);

  let args: arg.Result<typeof spec>;
  try {
    args = arg(spec, { argv, permissive: false });
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }

  if (args["--help"]) {
    renderHelp(projectsListSubcommand, { parent: projectsCommand });
    return 0;
  }

  await projectsHandler({
    action: "list",
    json: args["--json"],
    org: args["--org"],
  });

  return 0;
}

async function handleNew(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...projectsNewSubcommand.options, ...globalCommandOptions]);

  let args: arg.Result<typeof spec>;
  try {
    args = arg(spec, { argv, permissive: false });
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }

  if (args["--help"]) {
    renderHelp(projectsNewSubcommand, { parent: projectsCommand });
    return 0;
  }

  await projectsHandler({
    action: "new",
    org: args["--org"],
    region: args["--region"],
    name: args["--name"],
    yes: args["--yes"],
    dryRun: args["--dry-run"],
  });

  return 0;
}
