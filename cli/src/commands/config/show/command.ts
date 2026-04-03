/**
 * supa config show — command specification
 */

import { environmentOption, jsonOption } from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const showSubcommand = {
  name: "show",
  aliases: [],
  description: "Show the effective merged config for the current environment",
  arguments: [],
  options: [
    {
      ...environmentOption,
      description: "Override the environment (e.g. production, preview, staging)",
    },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "Show current config",
      value: "supa config show",
    },
    {
      name: "Show production config",
      value: "supa config show --environment production",
    },
    {
      name: "Show preview config",
      value: "supa config show --environment preview",
    },
  ],
} as const satisfies Command;
