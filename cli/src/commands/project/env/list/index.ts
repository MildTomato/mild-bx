/**
 * Environment list command handler
 */

import arg from "arg";
import { listSubcommand } from "../command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { envCommand } from "../command.js";
import { listCommand as listHandler } from "./src/list.js";

export { listSubcommand };

export default async function list(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...listSubcommand.options,
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
    renderHelp(listSubcommand, { parent: envCommand });
    return 0;
  }

  await listHandler({
    environment: args["--environment"],
    branch: args["--branch"],
    json: args["--json"],
    profile: args["--profile"],
  });

  return 0;
}
