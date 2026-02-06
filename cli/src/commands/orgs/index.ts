/**
 * Orgs command handler
 */

import arg from "arg";
import { orgsCommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { orgsCommand as orgsHandler } from "./src/orgs.js";

export { orgsCommand };

export default async function orgs(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...orgsCommand.options, ...globalCommandOptions]);

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
    renderHelp(orgsCommand);
    return 0;
  }

  await orgsHandler({
    json: args["--json"],
  });

  return 0;
}
