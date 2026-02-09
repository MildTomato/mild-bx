/**
 * Environment command router
 */

import { envCommand } from "./command.js";
import { renderHelp } from "@/util/commands/help.js";
import pull from "./pull/index.js";
import push from "./push/index.js";
import set from "./set/index.js";
import unset from "./unset/index.js";
import list from "./list/index.js";
import listEnvironments from "./list-environments/index.js";
import create from "./create/index.js";
import deleteEnv from "./delete/index.js";
import seed from "./seed/index.js";

export { envCommand };

export default async function env(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  // Handle help for main command
  if (subcommand === "--help" || subcommand === "-h" || !subcommand) {
    renderHelp(envCommand);
    return 0;
  }

  // Route to subcommand handlers
  switch (subcommand) {
    case "pull":
      return pull(rest);
    case "push":
      return push(rest);
    case "set":
      return set(rest);
    case "unset":
      return unset(rest);
    case "list":
    case "ls":
      return list(rest);
    case "list-environments":
    case "envs":
    case "environments":
      return listEnvironments(rest);
    case "create":
      return create(rest);
    case "delete":
    case "remove":
    case "rm":
      return deleteEnv(rest);
    case "seed":
      return seed(rest);
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      renderHelp(envCommand);
      return 1;
  }
}
