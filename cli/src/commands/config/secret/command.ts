import { branchOption, jsonOption, profileOption, scopeOption } from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const secretSubcommand = {
  name: "secret",
  aliases: [],
  description: "Manage config-backed secrets",
  arguments: [],
  options: [],
  examples: [
    {
      name: "Set GitHub OAuth secret",
      value: "supa config secret set SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET",
    },
  ],
  subcommands: [
    {
      name: "set",
      aliases: [],
      description: "Set a secret used by Supabase config",
      arguments: [
        { name: "FIELD_OR_ENV", required: true, description: "Config field path or canonical env var" },
        { name: "VALUE", required: false, description: "Secret value" },
      ],
      options: [scopeOption, branchOption, jsonOption, profileOption],
      examples: [
        {
          name: "Set GitHub OAuth secret",
          value: "supa config secret set SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET",
        },
        {
          name: "Set by config path",
          value: "supa config secret set auth.external.github.secret",
        },
      ],
    },
  ],
} as const satisfies Command;
