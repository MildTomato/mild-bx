/**
 * Project branches command router
 */

import arg from "arg";
import {
  branchesSubcommand,
  listSubcommand,
  createSubcommand,
  diffSubcommand,
  mergeSubcommand,
  updateSubcommand,
  deleteSubcommand,
} from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { projectCommand } from "@/commands/project/command.js";
import { listBranches } from "./src/list.js";
import { createBranch } from "./src/create.js";
import { diffBranch } from "./src/diff.js";
import { mergeBranch } from "./src/merge.js";
import { updateBranch } from "./src/update.js";
import { deleteBranch } from "./src/delete.js";

export { branchesSubcommand };

export async function branchesCommand(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  // Handle help for main command
  if (subcommand === "--help" || subcommand === "-h" || !subcommand) {
    renderHelp(branchesSubcommand, { parent: projectCommand });
    return 0;
  }

  // Route to subcommand handlers
  switch (subcommand) {
    case "list":
    case "ls": {
      const spec = getFlagsSpecification([...listSubcommand.options, ...globalCommandOptions]);
      let args: arg.Result<typeof spec>;
      try {
        args = arg(spec, { argv: rest, permissive: false });
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        }
        return 1;
      }

      if (args["--help"]) {
        renderHelp(listSubcommand, { parent: branchesSubcommand });
        return 0;
      }

      await listBranches({
        json: args["--json"],
        profile: args["--profile"],
      });
      return 0;
    }

    case "create": {
      const spec = getFlagsSpecification([...createSubcommand.options, ...globalCommandOptions]);
      let args: arg.Result<typeof spec>;
      try {
        args = arg(spec, { argv: rest, permissive: false });
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        }
        return 1;
      }

      if (args["--help"]) {
        renderHelp(createSubcommand, { parent: branchesSubcommand });
        return 0;
      }

      const name = args._[0];
      await createBranch(name, {
        persistent: args["--persistent"],
        "with-data": args["--with-data"],
        "git-branch": args["--git-branch"],
        noPush: args["--no-push"],
        json: args["--json"],
        yes: args["--yes"],
        profile: args["--profile"],
      });
      return 0;
    }

    case "diff": {
      const spec = getFlagsSpecification([...diffSubcommand.options, ...globalCommandOptions]);
      let args: arg.Result<typeof spec>;
      try {
        args = arg(spec, { argv: rest, permissive: false });
      } catch (err) {
        if (err instanceof Error) console.error(`Error: ${err.message}`);
        return 1;
      }
      if (args["--help"]) { renderHelp(diffSubcommand, { parent: branchesSubcommand }); return 0; }
      await diffBranch({ json: args["--json"], profile: args["--profile"], schemas: args["--schemas"] });
      return 0;
    }

    case "merge": {
      const spec = getFlagsSpecification([...mergeSubcommand.options, ...globalCommandOptions]);
      let args: arg.Result<typeof spec>;
      try {
        args = arg(spec, { argv: rest, permissive: false });
      } catch (err) {
        if (err instanceof Error) console.error(`Error: ${err.message}`);
        return 1;
      }
      if (args["--help"]) { renderHelp(mergeSubcommand, { parent: branchesSubcommand }); return 0; }
      await mergeBranch({ yes: args["--yes"], dryRun: args["--dry-run"], json: args["--json"], profile: args["--profile"], schemas: args["--schemas"] });
      return 0;
    }

    case "update": {
      const spec = getFlagsSpecification([...updateSubcommand.options, ...globalCommandOptions]);
      let args: arg.Result<typeof spec>;
      try {
        args = arg(spec, { argv: rest, permissive: false });
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        }
        return 1;
      }

      if (args["--help"]) {
        renderHelp(updateSubcommand, { parent: branchesSubcommand });
        return 0;
      }

      const nameOrId = args._[0];
      if (!nameOrId) {
        console.error("Error: Branch name or ID argument is required");
        console.error("Example: supa branches update <name-or-id> --name new-name");
        console.error("Run 'supa branches update --help' for more information");
        return 1;
      }

      await updateBranch(nameOrId, {
        name: args["--name"],
        "git-branch": args["--git-branch"],
        persistent: args["--persistent"],
        json: args["--json"],
        profile: args["--profile"],
      });
      return 0;
    }

    case "delete":
    case "rm": {
      const spec = getFlagsSpecification([...deleteSubcommand.options, ...globalCommandOptions]);
      let args: arg.Result<typeof spec>;
      try {
        args = arg(spec, { argv: rest, permissive: false });
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        }
        return 1;
      }

      if (args["--help"]) {
        renderHelp(deleteSubcommand, { parent: branchesSubcommand });
        return 0;
      }

      const nameOrId = args._[0];

      await deleteBranch(nameOrId, {
        force: args["--force"],
        yes: args["--yes"],
        json: args["--json"],
        profile: args["--profile"],
      });
      return 0;
    }

    default: {
      console.error(`Unknown subcommand: ${subcommand}`);
      renderHelp(branchesSubcommand, { parent: projectCommand });
      return 1;
    }
  }
}

export default branchesCommand;
