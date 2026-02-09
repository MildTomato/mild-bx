/**
 * Environment unset command handler
 */

import arg from "arg";
import { unsetSubcommand } from "../command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { envCommand } from "../command.js";
import { unsetCommand as unsetHandler } from "./src/unset.js";

export { unsetSubcommand };

export default async function unset(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...unsetSubcommand.options,
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
    renderHelp(unsetSubcommand, { parent: envCommand });
    return 0;
  }

  const [key] = args._;

  if (!key) {
    console.error("Error: KEY argument is required");
    renderHelp(unsetSubcommand, { parent: envCommand });
    return 1;
  }

  await unsetHandler({
    key,
    environment: args["--environment"],
    branch: args["--branch"],
    yes: args["--yes"],
    json: args["--json"],
    profile: args["--profile"],
  });

  return 0;
}
