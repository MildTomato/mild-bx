/**
 * Bootstrap command specification
 */

import {
  yesOption,
  jsonOption,
  dryRunOption,
} from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const bootstrapCommand = {
  name: "bootstrap",
  aliases: [],
  description: "Bootstrap a project from a starter template",
  arguments: [
    {
      name: "template",
      description: "Template name (optional, interactive if omitted)",
      required: false,
    },
  ],
  options: [
    { ...yesOption, description: "Skip prompts and use defaults" },
    { ...jsonOption },
    { ...dryRunOption },
    {
      name: "workdir",
      shorthand: "w",
      type: String,
      argument: "DIR",
      deprecated: false,
      description: "Directory to bootstrap into (default: current directory)",
    },
    {
      name: "password",
      shorthand: "p",
      type: String,
      argument: "PASSWORD",
      deprecated: false,
      description: "Password for remote Postgres database",
    },
  ],
  examples: [
    { name: "Interactive setup", value: "supa bootstrap" },
    { name: "Use a specific template", value: "supa bootstrap nextjs" },
  ],
} as const satisfies Command;
