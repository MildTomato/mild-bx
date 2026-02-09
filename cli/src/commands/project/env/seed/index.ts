/**
 * Seed environment command handler
 */

import arg from "arg";
import { seedSubcommand } from "../command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { envCommand } from "../command.js";
import { seedCommand as seedHandler } from "./src/seed.js";

export { seedSubcommand };

export default async function seed(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...seedSubcommand.options,
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
    renderHelp(seedSubcommand, { parent: envCommand });
    return 0;
  }

  const [target] = args._;

  if (!target) {
    console.error("Error: TARGET argument is required");
    renderHelp(seedSubcommand, { parent: envCommand });
    return 1;
  }

  if (!args["--from"]) {
    console.error("Error: --from option is required");
    renderHelp(seedSubcommand, { parent: envCommand });
    return 1;
  }

  await seedHandler({
    target,
    from: args["--from"],
    interactive: args["--interactive"],
    yes: args["--yes"],
    json: args["--json"],
    profile: args["--profile"],
  });

  return 0;
}
