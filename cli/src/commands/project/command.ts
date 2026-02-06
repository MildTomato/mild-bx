/**
 * Project command specification (parent for project subcommands)
 */

import { pushSubcommand } from "./push/command.js";
import { pullSubcommand } from "./pull/command.js";
import { seedSubcommand } from "./seed/command.js";
import { seedStatusSubcommand } from "./seed-status/command.js";
import { apiKeysSubcommand } from "./api-keys/command.js";
import { profileSubcommand } from "./profile/command.js";
import { devCommand } from "@/commands/dev/command.js";
import type { Command } from "@/util/commands/types.js";

export const projectCommand = {
  name: "project",
  aliases: [],
  description: "Project operations",
  arguments: [],
  subcommands: [
    pullSubcommand,
    pushSubcommand,
    devCommand,  // dev is also available under project
    seedSubcommand,
    seedStatusSubcommand,
    apiKeysSubcommand,
    profileSubcommand,
  ],
  options: [],
  examples: [
    {
      name: "Pull remote state",
      value: "supa project pull",
    },
    {
      name: "Push local changes",
      value: "supa project push",
    },
    {
      name: "Start development watcher",
      value: "supa project dev",
    },
  ],
} as const satisfies Command;
