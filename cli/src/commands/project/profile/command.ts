/**
 * Project profile command specification
 */

import { jsonOption } from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const profileSubcommand = {
  name: "profile",
  aliases: [],
  description: "View or change workflow profile",
  arguments: [],
  options: [
    {
      name: "set",
      shorthand: null,
      type: String,
      argument: "PROFILE",
      deprecated: false,
      description: "Set workflow profile (solo, staged, preview, preview-git)",
    },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "View current profile",
      value: "supa project profile",
    },
    {
      name: "Change to solo profile",
      value: "supa project profile --set solo",
    },
    {
      name: "Get profile as JSON",
      value: "supa project profile --json",
    },
  ],
} as const satisfies Command;
