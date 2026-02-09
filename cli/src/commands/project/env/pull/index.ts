/**
 * Environment pull command handler
 */

import arg from "arg";
import { pullSubcommand } from "../command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { envCommand } from "../command.js";
import { pullCommand as pullHandler } from "./src/pull.js";

export { pullSubcommand };

export default async function pull(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...pullSubcommand.options,
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
    renderHelp(pullSubcommand, { parent: envCommand });
    return 0;
  }

  await pullHandler({
    environment: args["--environment"],
    yes: args["--yes"],
    json: args["--json"],
    profile: args["--profile"],
  });

  return 0;
}
