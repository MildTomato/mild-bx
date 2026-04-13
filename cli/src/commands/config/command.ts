/**
 * supa config — command specification
 */

import type { Command } from "@/util/commands/types.js";
import { showSubcommand } from "./show/command.js";
import { diffSubcommand } from "./diff/command.js";
import { secretSubcommand } from "./secret/command.js";

export const configCommand = {
  name: "config",
  aliases: [],
  description: "Manage project config",
  arguments: [],
  options: [],
  subcommands: [showSubcommand, diffSubcommand, secretSubcommand],
  examples: [
    {
      name: "Show effective config",
      value: "supa config show",
    },
    {
      name: "Diff config between branches",
      value: "supa config diff main feat/my-feature",
    },
    {
      name: "Set a config secret",
      value: "supa config secret set SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET",
    },
  ],
} as const satisfies Command;
