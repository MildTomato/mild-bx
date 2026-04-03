/**
 * supa config show — entry point
 */

import arg from "arg";
import { showSubcommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { configCommand } from "@/commands/config/command.js";
import { showConfigCommand } from "./src/show.js";

export { showSubcommand };

export default async function show(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...showSubcommand.options, ...globalCommandOptions]);

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
    renderHelp(showSubcommand, { parent: configCommand });
    return 0;
  }

  await showConfigCommand({
    env: args["--environment"],
    json: args["--json"],
  });

  return 0;
}
