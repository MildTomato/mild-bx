/**
 * Project seed-status command handler
 */

import arg from "arg";
import { seedStatusSubcommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { projectCommand } from "@/commands/project/command.js";
import { seedStatusCommand as seedStatusHandler } from "@/commands/project/seed/src/seed.js";

export { seedStatusSubcommand };

export default async function seedStatus(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...seedStatusSubcommand.options, ...globalCommandOptions]);

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
    renderHelp(seedStatusSubcommand, { parent: projectCommand });
    return 0;
  }

  await seedStatusHandler({
    json: args["--json"],
  });

  return 0;
}
