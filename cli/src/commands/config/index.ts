/**
 * Config command router
 */

import { configCommand } from "./command.js";
import { renderHelp } from "@/util/commands/help.js";
import show from "./show/index.js";

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
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      renderHelp(configCommand);
      return 1;
  }
}
