/**
 * supa config diff — entry point
 */

import arg from "arg";
import { diffSubcommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions, profileOption } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { configCommand } from "@/commands/config/command.js";
import { diffConfigCommand } from "./src/diff.js";

export { diffSubcommand };

export default async function diff(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...diffSubcommand.options, profileOption, ...globalCommandOptions]);

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
    renderHelp(diffSubcommand, { parent: configCommand });
    return 0;
  }

  const [from, to] = args._;
  if (!from || !to) {
    console.error(`Error: <from> and <to> branch arguments are required.`);
    renderHelp(diffSubcommand, { parent: configCommand });
    return 1;
  }

  return diffConfigCommand({
    from,
    to,
    profile: args["--profile"],
    json: args["--json"],
  });
}
