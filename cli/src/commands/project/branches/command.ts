/**
 * Project branches command specifications
 */

import {
  profileOption,
  jsonOption,
  yesOption,
  dryRunOption,
  verboseOption,
} from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const listSubcommand = {
  name: "list",
  aliases: ["ls"],
  description: "List all database branches",
  arguments: [],
  options: [
    { ...profileOption },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "List all branches",
      value: "supa project branches list",
    },
    {
      name: "List branches as JSON",
      value: "supa project branches list --json",
    },
  ],
} as const satisfies Command;

export const createSubcommand = {
  name: "create",
  aliases: [],
  description: "Create a new database branch",
  arguments: [
    {
      name: "name",
      required: false,
      description: "Branch name (defaults to current git branch name)",
    },
  ],
  options: [
    {
      name: "persistent",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Create a persistent branch that survives PR close",
    },
    {
      name: "with-data",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Seed the branch with data from the parent project",
    },
    {
      name: "git-branch",
      shorthand: null,
      type: String,
      deprecated: false,
      description: "Associate with a specific git branch (overrides auto-detected)",
    },
    {
      name: "no-push",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Skip pushing local schema and config after branch is ready",
    },
    { ...profileOption },
    { ...jsonOption },
    { ...yesOption },
  ],
  examples: [
    {
      name: "Create branch from current git branch",
      value: "supa branches create",
    },
    {
      name: "Create a named branch",
      value: "supa branches create my-feature",
    },
    {
      name: "Create a persistent branch with data",
      value: "supa branches create staging --persistent --with-data",
    },
    {
      name: "Create branch tied to a specific git branch",
      value: "supa branches create my-feature --git-branch feat/my-feature",
    },
  ],
} as const satisfies Command;

export const updateSubcommand = {
  name: "update",
  aliases: [],
  description: "Update an existing database branch",
  arguments: [
    {
      name: "name-or-id",
      required: true,
      description: "Branch name or ID to update",
    },
  ],
  options: [
    {
      name: "name",
      shorthand: null,
      type: String,
      deprecated: false,
      description: "New name for the branch",
    },
    {
      name: "git-branch",
      shorthand: null,
      type: String,
      deprecated: false,
      description: "Associate with a different git branch",
    },
    {
      name: "persistent",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Make the branch persistent",
    },
    { ...profileOption },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "Rename a branch",
      value: "supa branches update my-feature --name my-new-feature",
    },
    {
      name: "Change associated git branch",
      value: "supa branches update my-feature --git-branch feat/other",
    },
    {
      name: "Make a branch persistent",
      value: "supa branches update my-feature --persistent",
    },
  ],
} as const satisfies Command;

export const deleteSubcommand = {
  name: "delete",
  aliases: ["rm"],
  description: "Delete a database branch",
  arguments: [
    {
      name: "name-or-id",
      required: true,
      description: "Branch name or ID to delete",
    },
  ],
  options: [
    {
      name: "force",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Delete immediately without a grace period",
    },
    { ...yesOption },
    { ...profileOption },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "Delete a branch interactively",
      value: "supa branches delete my-feature",
    },
    {
      name: "Delete without confirmation",
      value: "supa branches delete my-feature --yes",
    },
    {
      name: "Force-delete immediately",
      value: "supa branches delete my-feature --yes --force",
    },
  ],
} as const satisfies Command;

export const diffSubcommand = {
  name: "diff",
  aliases: [],
  description: "Show schema diff between the current branch and production",
  arguments: [],
  options: [
    {
      name: "schemas",
      shorthand: null,
      type: String,
      argument: "SCHEMAS",
      deprecated: false,
      description: "Comma-separated schemas to include (default: public)",
    },
    { ...profileOption },
    { ...jsonOption },
  ],
  examples: [
    { name: "Show diff for current branch", value: "supa project branches diff" },
    { name: "Show diff as JSON", value: "supa project branches diff --json" },
  ],
} as const satisfies Command;

export const mergeSubcommand = {
  name: "merge",
  aliases: [],
  description: "Merge the current branch into production",
  arguments: [],
  options: [
    {
      name: "schemas",
      shorthand: null,
      type: String,
      argument: "SCHEMAS",
      deprecated: false,
      description: "Comma-separated schemas to include in diff (default: public)",
    },
    { ...dryRunOption, description: "Show what would be merged without applying" },
    { ...yesOption },
    { ...profileOption },
    { ...jsonOption },
  ],
  examples: [
    { name: "Preview what would be merged", value: "supa project branches merge --dry-run" },
    { name: "Merge current branch (with confirmation)", value: "supa project branches merge" },
    { name: "Merge without confirmation", value: "supa project branches merge --yes" },
    { name: "Merge as JSON", value: "supa project branches merge --json --yes" },
  ],
} as const satisfies Command;

export const resetSubcommand = {
  name: "reset",
  aliases: [],
  description: "Wipe a preview branch and re-apply schema + seed",
  arguments: [],
  options: [
    { ...yesOption },
    { ...verboseOption },
    { ...profileOption },
    { ...jsonOption },
  ],
  examples: [
    { name: "Reset current branch (with confirmation)", value: "supa project branches reset" },
    { name: "Reset without confirmation", value: "supa project branches reset --yes" },
    { name: "Reset as JSON", value: "supa project branches reset --json --yes" },
  ],
} as const satisfies Command;

export const branchesSubcommand = {
  name: "branches",
  aliases: [],
  description: "Manage database branches for your project",
  arguments: [],
  subcommands: [listSubcommand, createSubcommand, diffSubcommand, mergeSubcommand, resetSubcommand, updateSubcommand, deleteSubcommand],
  options: [],
  examples: [
    {
      name: "List all branches",
      value: "supa branches list",
    },
    {
      name: "Create a branch from the current git branch",
      value: "supa branches create",
    },
    {
      name: "Update a branch",
      value: "supa branches update my-feature --name new-name",
    },
    {
      name: "Delete a branch",
      value: "supa branches delete my-feature",
    },
  ],
} as const satisfies Command;
