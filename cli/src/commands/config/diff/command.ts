/**
 * supa config diff — command specification
 */

import { jsonOption } from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const diffSubcommand = {
  name: "diff",
  aliases: [],
  description: "Show field-level config diff between two branches",
  arguments: [
    { name: "from", description: "Source branch (e.g. main)", required: true },
    { name: "to", description: "Target branch (e.g. feat/my-feature)", required: true },
  ],
  options: [
    { ...jsonOption },
  ],
  examples: [
    {
      name: "Compare feature branch against main",
      value: "supa config diff main feat/my-feature",
    },
    {
      name: "Compare two feature branches",
      value: "supa config diff feat/base feat/experiment",
    },
  ],
} as const satisfies Command;
