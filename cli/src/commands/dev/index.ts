/**
 * Dev command handler
 */

import arg from "arg";
import { devCommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { devCommand as devHandler } from "./src/dev.js";

export { devCommand };

export default async function dev(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...devCommand.options, ...globalCommandOptions]);

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
    renderHelp(devCommand);
    return 0;
  }

  // Call the existing handler with parsed options
  await devHandler({
    profile: args["--profile"],
    debounce: args["--debounce"],
    typesInterval: args["--types-interval"],
    noBranchWatch: args["--no-branch-watch"],
    seed: args["--seed"],
    noSeed: args["--no-seed"],
    dryRun: args["--dry-run"],
    verbose: args["--verbose"],
    json: args["--json"],
  });

  return 0;
}
