/**
 * Delete environment command handler
 */

import arg from "arg";
import { deleteSubcommand } from "../command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { envCommand } from "../command.js";
import { deleteCommand as deleteHandler } from "./src/delete.js";

export { deleteSubcommand };

export default async function deleteEnv(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...deleteSubcommand.options,
    ...globalCommandOptions,
  ]);

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
    renderHelp(deleteSubcommand, { parent: envCommand });
    return 0;
  }

  const [name] = args._;

  if (!name) {
    console.error("Error: NAME argument is required");
    renderHelp(deleteSubcommand, { parent: envCommand });
    return 1;
  }

  await deleteHandler({
    name,
    yes: args["--yes"],
    json: args["--json"],
    profile: args["--profile"],
  });

  return 0;
}
