/**
 * Project push command handler
 */

import arg from "arg";
import { pushSubcommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { projectCommand } from "@/commands/project/command.js";
import { pushCommand as pushHandler } from "./src/push.js";

export { pushSubcommand };

export default async function push(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...pushSubcommand.options, ...globalCommandOptions]);

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
    renderHelp(pushSubcommand, { parent: projectCommand });
    return 0;
  }

  await pushHandler({
    profile: args["--profile"],
    plan: args["--plan"],
    yes: args["--yes"],
    migrationsOnly: args["--migrations-only"],
    configOnly: args["--config-only"],
    json: args["--json"],
    verbose: args["--verbose"],
  });

  return 0;
}
