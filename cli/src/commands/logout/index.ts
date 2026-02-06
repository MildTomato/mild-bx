/**
 * Logout command handler
 */

import arg from "arg";
import { logoutCommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { logoutCommand as logoutHandler } from "./src/logout.js";

export { logoutCommand };

export default async function logout(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...logoutCommand.options, ...globalCommandOptions]);

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
    renderHelp(logoutCommand);
    return 0;
  }

  await logoutHandler({
    yes: args["--yes"],
    json: args["--json"],
  });

  return 0;
}
