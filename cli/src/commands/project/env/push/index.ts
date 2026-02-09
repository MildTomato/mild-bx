/**
 * Environment push command handler
 */

import arg from "arg";
import { pushSubcommand } from "../command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { envCommand } from "../command.js";
import { pushCommand as pushHandler } from "./src/push.js";

export { pushSubcommand };

export default async function push(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...pushSubcommand.options,
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
    renderHelp(pushSubcommand, { parent: envCommand });
    return 0;
  }

  await pushHandler({
    environment: args["--environment"],
    prune: args["--prune"],
    dryRun: args["--dry-run"],
    yes: args["--yes"],
    json: args["--json"],
    profile: args["--profile"],
  });

  return 0;
}
