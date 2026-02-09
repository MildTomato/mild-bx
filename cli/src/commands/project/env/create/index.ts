/**
 * Create environment command handler
 */

import arg from "arg";
import { createSubcommand } from "../command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { envCommand } from "../command.js";
import { createCommand as createHandler } from "./src/create.js";

export { createSubcommand };

export default async function create(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([
    ...createSubcommand.options,
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
    renderHelp(createSubcommand, { parent: envCommand });
    return 0;
  }

  const [name] = args._;

  if (!name) {
    console.error("Error: NAME argument is required");
    renderHelp(createSubcommand, { parent: envCommand });
    return 1;
  }

  await createHandler({
    name,
    from: args["--from"],
    interactive: args["--interactive"],
    json: args["--json"],
    profile: args["--profile"],
  });

  return 0;
}
