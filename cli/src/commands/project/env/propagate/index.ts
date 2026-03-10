/**
 * Environment propagate command handler
 */

import arg from "arg";
import { propagateSubcommand } from "../command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { envCommand } from "../command.js";
import { propagateCommand as propagateHandler } from "./src/propagate.js";

export { propagateSubcommand };

export default async function propagate(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...propagateSubcommand.options,
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
    renderHelp(propagateSubcommand, { parent: envCommand });
    return 0;
  }

  await propagateHandler({
    branch: args["--branch"],
    dryRun: args["--dry-run"],
    yes: args["--yes"],
    json: args["--json"],
    profile: args["--profile"],
  });

  return 0;
}
