/**
 * Logout command specification
 */

import { jsonOption, yesOption } from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const logoutCommand = {
  name: "logout",
  aliases: [],
  description: "Log out and remove stored access token",
  arguments: [],
  options: [
    { ...yesOption, description: "Skip confirmation prompt" },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "Logout (with confirmation)",
      value: "supa logout",
    },
    {
      name: "Logout without confirmation",
      value: "supa logout --yes",
    },
  ],
} as const satisfies Command;
