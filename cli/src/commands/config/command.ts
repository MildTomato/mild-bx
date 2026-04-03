/**
 * supa config — command specification
 */

import type { Command } from "@/util/commands/types.js";
import { showSubcommand } from "./show/command.js";

export const configCommand = {
  name: "config",
  aliases: [],
  description: "Manage project config",
  arguments: [],
  options: [],
  subcommands: [showSubcommand],
  examples: [
    {
      name: "Show effective config",
      value: "supa config show",
    },
  ],
} as const satisfies Command;
