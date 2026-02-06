/**
 * Project api-keys command specification
 */

import {
  profileOption,
  jsonOption,
} from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const apiKeysSubcommand = {
  name: "api-keys",
  aliases: ["keys"],
  description: "List API keys for the project",
  arguments: [],
  options: [
    { ...profileOption },
    {
      name: "reveal",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Show full API keys (not masked)",
    },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "List API keys (masked)",
      value: "supa project api-keys",
    },
    {
      name: "Show full API keys",
      value: "supa project api-keys --reveal",
    },
    {
      name: "Get keys as JSON",
      value: "supa project api-keys --json --reveal",
    },
  ],
} as const satisfies Command;
