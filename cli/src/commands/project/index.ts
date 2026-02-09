/**
 * Project command router
 */

import { projectCommand } from "./command.js";
import { renderHelp } from "@/util/commands/help.js";
import push from "./push/index.js";
import pull from "./pull/index.js";
import seed from "./seed/index.js";
import seedStatus from "./seed-status/index.js";
import apiKeys from "./api-keys/index.js";
import profile from "./profile/index.js";
import authProvider from "./auth-provider/index.js";
import env from "./env/index.js";
import dev from "@/commands/dev/index.js";

export { projectCommand };

export default async function project(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  // Handle help for main command
  if (subcommand === "--help" || subcommand === "-h" || !subcommand) {
    renderHelp(projectCommand);
    return 0;
  }

  // Route to subcommand handlers
  switch (subcommand) {
    case "push":
      return push(rest);
    case "pull":
      return pull(rest);
    case "dev":
      return dev(rest);
    case "seed":
      return seed(rest);
    case "seed-status":
      return seedStatus(rest);
    case "api-keys":
    case "keys":
      return apiKeys(rest);
    case "profile":
      return profile(rest);
    case "auth-provider":
    case "auth":
      return authProvider(rest);
    case "env":
      return env(rest);
    default:
      // Check for common mistakes
      if (subcommand === "--set") {
        const setValue = rest[0] || "<profile>";
        console.error(`Did you mean: supa project profile --set ${setValue}`);
        return 1;
      }
      console.error(`Unknown subcommand: ${subcommand}`);
      renderHelp(projectCommand);
      return 1;
  }
}
