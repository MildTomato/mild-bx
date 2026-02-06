/**
 * Init command handler
 */

import arg from "arg";
import { initCommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { initCommand as initHandler } from "./src/init.js";

export { initCommand };

export default async function init(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...initCommand.options, ...globalCommandOptions]);

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
    renderHelp(initCommand);
    return 0;
  }

  // Call the existing handler with parsed options
  await initHandler({
    yes: args["--yes"],
    json: args["--json"],
    org: args["--org"],
    project: args["--project"],
    name: args["--name"],
    region: args["--region"],
    dryRun: args["--dry-run"],
  });

  return 0;
}
