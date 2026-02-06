/**
 * Projects command specification
 */

import { jsonOption, orgOption, regionOption, nameOption, yesOption, dryRunOption } from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

const listSubcommand = {
  name: "list",
  aliases: [],
  description: "List all projects",
  default: true,
  arguments: [],
  options: [
    { ...jsonOption },
    { ...orgOption, description: "Filter by organization ID" },
  ],
  examples: [],
} as const satisfies Command;

const newSubcommand = {
  name: "new",
  aliases: ["create"],
  description: "Create a new project",
  arguments: [],
  options: [
    { ...orgOption, description: "Organization ID" },
    { ...regionOption },
    { ...nameOption, description: "Project name" },
    { ...yesOption, description: "Skip confirmation prompts" },
    { ...dryRunOption, description: "Preview what would be created without making changes" },
  ],
  examples: [],
} as const satisfies Command;

export const projectsCommand = {
  name: "projects",
  aliases: [],
  description: "Manage projects",
  arguments: [],
  subcommands: [listSubcommand, newSubcommand],
  options: [],
  examples: [
    {
      name: "List all projects",
      value: "supa projects list",
    },
    {
      name: "List projects for an org",
      value: "supa projects list --org my-org",
    },
    {
      name: "Create a new project",
      value: "supa projects new",
    },
  ],
} as const satisfies Command;

export { listSubcommand as projectsListSubcommand, newSubcommand as projectsNewSubcommand };
