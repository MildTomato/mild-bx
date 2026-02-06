/**
 * Project seed command specification
 */

import {
  profileOption,
  dryRunOption,
  jsonOption,
  verboseOption,
} from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const seedSubcommand = {
  name: "seed",
  aliases: [],
  description: "Run seed files against the database",
  arguments: [],
  options: [
    { ...profileOption },
    { ...dryRunOption, description: "Show what would be seeded without applying" },
    { ...verboseOption, description: "Show detailed logging" },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "Apply seed files",
      value: "supa project seed",
    },
    {
      name: "Preview seed files",
      value: "supa project seed --dry-run",
    },
  ],
} as const satisfies Command;
