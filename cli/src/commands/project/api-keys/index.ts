/**
 * Project api-keys command handler
 */

import arg from "arg";
import { apiKeysSubcommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { projectCommand } from "@/commands/project/command.js";
import { apiKeysCommand as apiKeysHandler } from "./src/api-keys.js";

export { apiKeysSubcommand };

export default async function apiKeys(argv: string[]): Promise<number> {
  const spec = getFlagsSpecification([...apiKeysSubcommand.options, ...globalCommandOptions]);

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
    renderHelp(apiKeysSubcommand, { parent: projectCommand });
    return 0;
  }

  await apiKeysHandler({
    profile: args["--profile"],
    reveal: args["--reveal"],
    json: args["--json"],
  });

  return 0;
}
