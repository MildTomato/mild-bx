/**
 * Project push command specification
 */

import {
  profileOption,
  planOption,
  yesOption,
  jsonOption,
  verboseOption,
} from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const pushSubcommand = {
  name: "push",
  aliases: [],
  description: "Push local changes to remote (local → remote)",
  arguments: [],
  options: [
    { ...profileOption },
    { ...planOption },
    { ...yesOption, description: "Skip confirmation prompt" },
    {
      name: "migrations-only",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Only apply migrations",
    },
    {
      name: "config-only",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Only apply config changes (api, auth settings)",
    },
    { ...jsonOption },
    { ...verboseOption, description: "Show detailed pg-delta logging" },
  ],
  examples: [
    {
      name: "Push all changes",
      value: "supa project push",
    },
    {
      name: "Preview changes without applying",
      value: "supa project push --plan",
    },
    {
      name: "Push without confirmation",
      value: "supa project push --yes",
    },
  ],
} as const satisfies Command;
