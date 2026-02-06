/**
 * Project pull command specification
 */

import {
  profileOption,
  planOption,
  jsonOption,
  verboseOption,
  yesOption,
} from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const pullSubcommand = {
  name: "pull",
  aliases: [],
  description: "Pull remote state to local (remote → local)",
  arguments: [],
  options: [
    { ...profileOption },
    { ...planOption, description: "Show what would happen without making changes" },
    {
      name: "types-only",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Only generate TypeScript types",
    },
    {
      name: "schemas",
      shorthand: null,
      type: String,
      argument: "SCHEMAS",
      deprecated: false,
      description: "Schemas to include for type generation (default: public)",
    },
    { ...jsonOption },
    { ...verboseOption, description: "Show detailed pg-delta logging" },
    { ...yesOption, description: "Skip confirmation prompt" },
  ],
  examples: [
    {
      name: "Pull remote state",
      value: "supa project pull",
    },
    {
      name: "Preview what would be pulled",
      value: "supa project pull --plan",
    },
    {
      name: "Only regenerate types",
      value: "supa project pull --types-only",
    },
  ],
} as const satisfies Command;
