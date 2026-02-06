/**
 * Project profile command handler
 */

import arg from "arg";
import { profileSubcommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { projectCommand } from "@/commands/project/command.js";
import { profileCommand as profileHandler } from "./src/profile.js";
import type { WorkflowProfile } from "@/lib/config-types.js";

export { profileSubcommand };

export default async function profile(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...profileSubcommand.options, ...globalCommandOptions]);

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
    renderHelp(profileSubcommand, { parent: projectCommand });
    return 0;
  }

  await profileHandler({
    set: args["--set"] as WorkflowProfile | undefined,
    json: args["--json"],
  });

  return 0;
}
