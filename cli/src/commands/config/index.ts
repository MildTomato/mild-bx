/**
 * Config command router
 */

import { configCommand } from "./command.js";
import { renderHelp } from "@/util/commands/help.js";
import show from "./show/index.js";
import diff from "./diff/index.js";
import secret from "./secret/index.js";

export { configCommand };

export default async function config(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (subcommand === "--help" || subcommand === "-h" || !subcommand) {
    renderHelp(configCommand);
    return 0;
  }

  switch (subcommand) {
    case "show":
      return show(rest);
    case "diff":
      return diff(rest);
    case "secret":
      return secret(rest);
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      renderHelp(configCommand);
      return 1;
  }
}
