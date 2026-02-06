/**
 * Project seed-status command specification
 */

import { jsonOption } from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const seedStatusSubcommand = {
  name: "seed-status",
  aliases: [],
  description: "Show seed configuration and files",
  arguments: [],
  options: [
    { ...jsonOption },
  ],
  examples: [
    {
      name: "Show seed configuration",
      value: "supa project seed-status",
    },
  ],
} as const satisfies Command;
