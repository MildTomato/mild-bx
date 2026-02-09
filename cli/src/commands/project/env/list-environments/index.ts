/**
 * List environments command handler
 */

import arg from "arg";
import { listEnvironmentsSubcommand } from "../command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { envCommand } from "../command.js";
import { listEnvironmentsCommand as listEnvHandler } from "./src/list-environments.js";

export { listEnvironmentsSubcommand };

export default async function listEnvironments(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...listEnvironmentsSubcommand.options,
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
    renderHelp(listEnvironmentsSubcommand, { parent: envCommand });
    return 0;
  }

  await listEnvHandler({
    json: args["--json"],
    profile: args["--profile"],
  });

  return 0;
}
