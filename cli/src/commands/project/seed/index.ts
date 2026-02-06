/**
 * Project seed command handler
 */

import arg from "arg";
import { seedSubcommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { projectCommand } from "@/commands/project/command.js";
import { seedCommand as seedHandler } from "./src/seed.js";

export { seedSubcommand };

export default async function seed(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...seedSubcommand.options, ...globalCommandOptions]);

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
    renderHelp(seedSubcommand, { parent: projectCommand });
    return 0;
  }

  await seedHandler({
    profile: args["--profile"],
    dryRun: args["--dry-run"],
    verbose: args["--verbose"],
    json: args["--json"],
  });

  return 0;
}
