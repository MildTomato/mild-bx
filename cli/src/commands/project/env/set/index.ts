/**
 * Environment set command handler
 */

import arg from "arg";
import { setSubcommand } from "../command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { envCommand } from "../command.js";
import { setCommand as setHandler } from "./src/set.js";

export { setSubcommand };

export default async function set(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...setSubcommand.options,
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
    renderHelp(setSubcommand, { parent: envCommand });
    return 0;
  }

  const [key, value] = args._;

  if (!key) {
    console.error("Error: KEY argument is required");
    renderHelp(setSubcommand, { parent: envCommand });
    return 1;
  }

  await setHandler({
    key,
    value,
    environment: args["--environment"],
    branch: args["--branch"],
    secret: args["--secret"],
    json: args["--json"],
    profile: args["--profile"],
  });

  return 0;
}
