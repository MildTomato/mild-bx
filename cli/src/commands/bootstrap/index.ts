/**
 * Bootstrap command handler
 */

import arg from "arg";
import { bootstrapCommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { bootstrapHandler } from "./src/bootstrap.js";

export { bootstrapCommand };

export default async function bootstrap(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...bootstrapCommand.options,
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
    renderHelp(bootstrapCommand);
    return 0;
  }

  // Positional arg is the template name
  const templateName = args._[0];

  await bootstrapHandler({
    template: templateName,
    yes: args["--yes"],
    json: args["--json"],
    dryRun: args["--dry-run"],
    workdir: args["--workdir"],
    password: args["--password"],
  });

  return 0;
}
