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
    {
      name: "local",
      shorthand: null,
      type: Boolean,
      argument: null,
      deprecated: false,
      description: "Initialize locally without connecting to Supabase Platform",
    },
    { ...orgOption, description: "Organization slug" },
    {
      name: "project",
      shorthand: null,
      type: String,
      argument: "REF",
      deprecated: false,
      description: "Link to existing project by ref",
    },
    {
      name: "new",
      shorthand: null,
      type: Boolean,
      argument: null,
      deprecated: false,
      description: "Create a new project (requires --org, --name, --region)",
    },
    {
      name: "link",
      shorthand: null,
      type: String,
      argument: "REF",
      deprecated: false,
      description: "Link to an existing project by ref",
    },
    { ...nameOption, description: "Name for new project (requires --org and --region)" },
    { ...regionOption, description: "Region for new project (e.g., us-east-1)" },
    {
      name: "workflow-profile",
      shorthand: null,
      type: String,
      argument: "PROFILE",
      deprecated: false,
      description: "Workflow profile: remote, local, branching-remote, branching-local (default: branching-remote)",
    },
    {
      name: "schema-management",
      shorthand: null,
      type: String,
      argument: "MODE",
      deprecated: false,
      description: "Schema management: declarative, migrations (default: declarative)",
    },
    {
      name: "config-source",
      shorthand: null,
      type: String,
      argument: "SOURCE",
      deprecated: false,
      description: "Config source: code, remote (default: code)",
    },
    { ...jsonOption },
    { ...dryRunOption, description: "Preview what would be created without making changes" },
  ],
  examples: [
    {
      name: "Interactive setup",
      value: "supa init",
    },
    {
      name: "Local development (no account needed)",
      value: "supa init --local",
    },
    {
      name: "Create new project non-interactively",
      value: "supa init --new --org my-org --name my-project --region us-east-1",
    },
    {
      name: "Link to existing project",
      value: "supa init --link abc123xyz",
    },
  ],
} as const satisfies Command;
