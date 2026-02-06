/**
 * Init command specification
 */

import {
  yesOption,
  jsonOption,
  orgOption,
  regionOption,
  nameOption,
  dryRunOption,
} from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const initCommand = {
  name: "init",
  aliases: [],
  description: "Initialize a new supabase project",
  arguments: [],
  options: [
    { ...yesOption, description: "Skip prompts and use defaults" },
    { ...orgOption, description: "Organization slug" },
    {
      name: "project",
      shorthand: null,
      type: String,
      argument: "REF",
      deprecated: false,
      description: "Link to existing project by ref",
    },
    { ...nameOption, description: "Name for new project (requires --org and --region)" },
    { ...regionOption, description: "Region for new project (e.g., us-east-1)" },
    { ...jsonOption },
    { ...dryRunOption, description: "Preview what would be created without making changes" },
  ],
  examples: [
    {
      name: "Interactive setup",
      value: "supa init",
    },
    {
      name: "Link to existing project",
      value: "supa init --project abc123xyz",
    },
    {
      name: "Create new project non-interactively",
      value: "supa init --org my-org --name my-project --region us-east-1",
    },
  ],
} as const satisfies Command;
