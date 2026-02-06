/**
 * Login command handler
 */

import arg from "arg";
import { loginCommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { loginCommand as loginHandler } from "./src/login.js";

export { loginCommand };

export default async function login(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...loginCommand.options, ...globalCommandOptions]);

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
    renderHelp(loginCommand);
    return 0;
  }

  await loginHandler({
    token: args["--token"],
    json: args["--json"],
    noBrowser: args["--no-browser"],
  });

  return 0;
}
