/**
 * Login command specification
 */

import { jsonOption } from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const loginCommand = {
  name: "login",
  aliases: [],
  description: "Authenticate with Supabase",
  arguments: [],
  options: [
    {
      name: "token",
      shorthand: null,
      type: String,
      deprecated: false,
      description: "Use provided access token instead of browser login",
      argument: "TOKEN",
    },
    {
      name: "no-browser",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Print login URL instead of opening browser",
    },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "Login via browser (default)",
      value: "supa login",
    },
    {
      name: "Login with a token directly",
      value: "supa login --token sbp_xxx",
    },
  ],
} as const satisfies Command;
