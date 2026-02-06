/**
 * Project auth-provider command specifications
 */

import {
  profileOption,
  jsonOption,
  yesOption,
} from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const listSubcommand = {
  name: "list",
  aliases: [],
  description: "List all OAuth providers and their status",
  arguments: [],
  options: [
    { ...profileOption },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "List all providers",
      value: "supa project auth-provider list",
    },
  ],
} as const satisfies Command;

export const addSubcommand = {
  name: "add",
  aliases: [],
  description: "Configure an OAuth provider",
  arguments: [
    {
      name: "provider",
      required: false,
      description: "Provider to configure (e.g., google, github, apple)",
    },
  ],
  options: [
    {
      name: "client-id",
      shorthand: null,
      type: String,
      deprecated: false,
      description: "OAuth client ID",
    },
    {
      name: "secret",
      shorthand: null,
      type: String,
      deprecated: false,
      description: "OAuth client secret",
    },
    {
      name: "secret-from-env",
      shorthand: null,
      type: String,
      deprecated: false,
      description: "Read secret from environment variable",
    },
    {
      name: "url",
      shorthand: null,
      type: String,
      deprecated: false,
      description: "Provider URL (for Azure, GitLab, Keycloak, WorkOS)",
    },
    {
      name: "redirect-uri",
      shorthand: null,
      type: String,
      deprecated: false,
      description: "Custom redirect URI (optional, defaults to Supabase callback)",
    },
    {
      name: "skip-nonce-check",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Skip nonce validation",
    },
    {
      name: "dry-run",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Preview changes without applying them",
    },
    { ...profileOption },
    { ...jsonOption },
    { ...yesOption },
  ],
  examples: [
    {
      name: "Interactive provider setup",
      value: "supa project auth-provider add",
    },
    {
      name: "Configure GitHub provider",
      value: "supa project auth-provider add github --client-id abc123 --secret xyz789",
    },
  ],
} as const satisfies Command;

export const enableSubcommand = {
  name: "enable",
  aliases: [],
  description: "Enable an OAuth provider",
  arguments: [
    {
      name: "provider",
      required: true,
      description: "Provider to enable (e.g., google, github)",
    },
  ],
  options: [
    {
      name: "dry-run",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Preview changes without applying them",
    },
    { ...profileOption },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "Enable Google provider",
      value: "supa project auth-provider enable google",
    },
  ],
} as const satisfies Command;

export const disableSubcommand = {
  name: "disable",
  aliases: [],
  description: "Disable an OAuth provider",
  arguments: [
    {
      name: "provider",
      required: true,
      description: "Provider to disable (e.g., google, github)",
    },
  ],
  options: [
    {
      name: "dry-run",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Preview changes without applying them",
    },
    { ...profileOption },
    { ...jsonOption },
  ],
  examples: [
    {
      name: "Disable Google provider",
      value: "supa project auth-provider disable google",
    },
  ],
} as const satisfies Command;

export const authProviderSubcommand = {
  name: "auth-provider",
  aliases: ["auth"],
  description: "Manage OAuth providers for your project",
  arguments: [],
  subcommands: [listSubcommand, addSubcommand, enableSubcommand, disableSubcommand],
  options: [],
  examples: [
    {
      name: "List configured providers",
      value: "supa project auth-provider list",
    },
    {
      name: "Add a new provider",
      value: "supa project auth-provider add google",
    },
    {
      name: "Enable a provider",
      value: "supa project auth-provider enable github",
    },
  ],
} as const satisfies Command;
