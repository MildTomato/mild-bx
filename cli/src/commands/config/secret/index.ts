import arg from "arg";
import { secretSubcommand } from "./command.js";
import { configCommand } from "../command.js";
import { renderHelp } from "@/util/commands/help.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { setConfigSecret } from "./src/set.js";

export { secretSubcommand };

export default async function secret(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  const setCommand = secretSubcommand.subcommands[0];

  if (subcommand === "--help" || subcommand === "-h" || !subcommand) {
    renderHelp(secretSubcommand, { parent: configCommand });
    return 0;
  }

  if (subcommand !== "set") {
    console.error(`Unknown subcommand: ${subcommand}`);
    renderHelp(secretSubcommand, { parent: configCommand });
    return 1;
  }

  const spec = getFlagsSpecification([...setCommand.options, ...globalCommandOptions]);
  let args: arg.Result<typeof spec>;
  try {
    args = arg(spec, { argv: rest, permissive: false });
  } catch (err) {
    if (err instanceof Error) console.error(`Error: ${err.message}`);
    return 1;
  }

  if (args["--help"]) {
    renderHelp(setCommand, { parent: secretSubcommand });
    return 0;
  }

  let [fieldOrEnv, value] = args._;
  if (!fieldOrEnv) {
    console.error("Error: FIELD_OR_ENV argument is required");
    renderHelp(setCommand, { parent: secretSubcommand });
    return 1;
  }
  if (value === undefined && fieldOrEnv.includes("=")) {
    const [key, ...restValue] = fieldOrEnv.split("=");
    fieldOrEnv = key;
    value = restValue.join("=");
  }

  await setConfigSecret({
    fieldOrEnv,
    value,
    scope: args["--scope"] as "production" | "preview" | "branch" | "development" | undefined,
    branch: args["--branch"],
    json: args["--json"],
    profile: args["--profile"],
  });
  return 0;
}
