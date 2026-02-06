/**
 * Orgs command specification
 */

import { jsonOption } from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const orgsCommand = {
  name: "orgs",
  aliases: [],
  description: "List organizations",
  arguments: [],
  options: [
    { ...jsonOption },
  ],
  examples: [
    {
      name: "List all organizations",
      value: "supa orgs",
    },
    {
      name: "Get organizations as JSON",
      value: "supa orgs --json",
    },
  ],
} as const satisfies Command;
