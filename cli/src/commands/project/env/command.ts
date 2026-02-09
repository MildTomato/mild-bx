/**
 * Environment variable management command specification
 */

import type { Command } from "@/util/commands/types.js";
import {
  environmentOption,
  branchOption,
  secretOption,
  pruneOption,
  yesOption,
  jsonOption,
  profileOption,
  dryRunOption,
} from "@/util/commands/arg-common.js";

// Pull subcommand
export const pullSubcommand = {
  name: "pull",
  aliases: [],
  description: "Pull remote environment variables to .env file",
  arguments: [],
  options: [environmentOption, yesOption, jsonOption, profileOption],
  examples: [
    {
      name: "Pull from development environment",
      value: "supa project env pull",
    },
    {
      name: "Pull from production environment",
      value: "supa project env pull --environment production",
    },
  ],
} as const satisfies Command;

// Push subcommand
export const pushSubcommand = {
  name: "push",
  aliases: [],
  description: "Push local .env variables to remote environment",
  arguments: [],
  options: [
    environmentOption,
    pruneOption,
    dryRunOption,
    yesOption,
    jsonOption,
    profileOption,
  ],
  examples: [
    {
      name: "Push to development environment",
      value: "supa project env push",
    },
    {
      name: "Preview changes without applying",
      value: "supa project env push --dry-run",
    },
    {
      name: "Push and remove variables not in .env",
      value: "supa project env push --prune",
    },
  ],
} as const satisfies Command;

// Set subcommand
export const setSubcommand = {
  name: "set",
  aliases: [],
  description: "Set a single environment variable",
  arguments: [
    { name: "KEY", required: true },
    { name: "VALUE", required: false },
  ],
  options: [
    environmentOption,
    branchOption,
    secretOption,
    jsonOption,
    profileOption,
  ],
  examples: [
    {
      name: "Set a variable",
      value: 'supa project env set API_KEY "sk_test_123"',
    },
    {
      name: "Set a secret variable",
      value: 'supa project env set STRIPE_KEY "sk_live_456" --secret',
    },
    {
      name: "Set branch override",
      value: 'supa project env set DEBUG "true" --branch feature-x',
    },
  ],
} as const satisfies Command;

// Unset subcommand
export const unsetSubcommand = {
  name: "unset",
  aliases: [],
  description: "Delete an environment variable",
  arguments: [{ name: "KEY", required: true }],
  options: [environmentOption, branchOption, yesOption, jsonOption, profileOption],
  examples: [
    {
      name: "Delete a variable",
      value: "supa project env unset OLD_KEY",
    },
    {
      name: "Delete branch override",
      value: "supa project env unset DEBUG --branch feature-x",
    },
  ],
} as const satisfies Command;

// List subcommand
export const listSubcommand = {
  name: "list",
  aliases: ["ls"],
  description: "List environment variables for an environment",
  arguments: [],
  options: [environmentOption, branchOption, jsonOption, profileOption],
  examples: [
    {
      name: "List development variables",
      value: "supa project env list",
    },
    {
      name: "List production variables",
      value: "supa project env list --environment production",
    },
  ],
} as const satisfies Command;

// List-environments subcommand
export const listEnvironmentsSubcommand = {
  name: "list-environments",
  aliases: ["envs", "environments"],
  description: "List all environments for the project",
  arguments: [],
  options: [jsonOption, profileOption],
  examples: [
    {
      name: "List all environments",
      value: "supa project env list-environments",
    },
  ],
} as const satisfies Command;

// Create subcommand
export const createSubcommand = {
  name: "create",
  aliases: [],
  description: "Create a custom environment",
  arguments: [{ name: "NAME", required: true }],
  options: [
    {
      name: "from",
      shorthand: null,
      type: String,
      argument: "ENV",
      deprecated: false,
      description: "Copy variables from this environment",
    },
    {
      name: "interactive",
      shorthand: "i",
      type: Boolean,
      deprecated: false,
      description: "Interactively configure the environment",
    },
    jsonOption,
    profileOption,
  ],
  examples: [
    {
      name: "Create empty environment",
      value: "supa project env create staging",
    },
    {
      name: "Create from production",
      value: "supa project env create staging --from production",
    },
  ],
} as const satisfies Command;

// Delete subcommand
export const deleteSubcommand = {
  name: "delete",
  aliases: ["remove", "rm"],
  description: "Delete a custom environment",
  arguments: [{ name: "NAME", required: true }],
  options: [yesOption, jsonOption, profileOption],
  examples: [
    {
      name: "Delete an environment",
      value: "supa project env delete staging",
    },
  ],
} as const satisfies Command;

// Seed subcommand
export const seedSubcommand = {
  name: "seed",
  aliases: [],
  description: "Seed one environment from another",
  arguments: [{ name: "TARGET", required: true }],
  options: [
    {
      name: "from",
      shorthand: null,
      type: String,
      argument: "ENV",
      deprecated: false,
      description: "Source environment (required)",
    },
    {
      name: "interactive",
      shorthand: "i",
      type: Boolean,
      deprecated: false,
      description: "Interactively select variables to copy",
    },
    yesOption,
    jsonOption,
    profileOption,
  ],
  examples: [
    {
      name: "Seed staging from production",
      value: "supa project env seed staging --from production",
    },
    {
      name: "Interactively select variables",
      value: "supa project env seed staging --from production --interactive",
    },
  ],
} as const satisfies Command;

// Parent env command
export const envCommand = {
  name: "env",
  aliases: [],
  description: "Manage environment variables",
  arguments: [],
  subcommands: [
    pullSubcommand,
    pushSubcommand,
    setSubcommand,
    unsetSubcommand,
    listSubcommand,
    listEnvironmentsSubcommand,
    createSubcommand,
    deleteSubcommand,
    seedSubcommand,
  ],
  options: [],
  examples: [
    {
      name: "Pull variables from development",
      value: "supa project env pull",
    },
    {
      name: "Set a variable",
      value: 'supa project env set API_KEY "value"',
    },
    {
      name: "List all environments",
      value: "supa project env list-environments",
    },
  ],
} as const satisfies Command;
