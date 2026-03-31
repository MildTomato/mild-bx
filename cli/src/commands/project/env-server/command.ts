import type { Command } from "@/util/commands/types.js";
import { jsonOption, profileOption, yesOption } from "@/util/commands/arg-common.js";

export const envServerResetSubcommand = {
  name: "reset",
  aliases: [],
  description: "Clear all env-server entries for this project",
  arguments: [],
  options: [yesOption, jsonOption, profileOption],
  examples: [
    {
      name: "Clear all env-server entries",
      value: "supa project env-server reset",
    },
  ],
} as const satisfies Command;

export const envServerSyncSubcommand = {
  name: "sync",
  aliases: [],
  description: "Clear env-server and re-sync from remote project config",
  arguments: [],
  options: [jsonOption, profileOption],
  examples: [
    {
      name: "Sync env-server from remote",
      value: "supa project env-server sync",
    },
  ],
} as const satisfies Command;

export const envServerCommand = {
  name: "env-server",
  aliases: [],
  description: "Debug utilities for the local env-server",
  arguments: [],
  subcommands: [envServerResetSubcommand, envServerSyncSubcommand],
  options: [],
  examples: [],
} as const satisfies Command;
