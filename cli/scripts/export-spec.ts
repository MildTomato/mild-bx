#!/usr/bin/env tsx
/**
 * Export CLI spec as JSON
 *
 * Outputs a complete JSON schema of the CLI's commands, options, and structure.
 * This can be used for documentation generation, IDE autocompletion, or validation.
 *
 * Usage:
 *   pnpm docs:spec > spec.json
 */

import { commandSpecs } from "../src/commands/index.js";
import type { Command } from "../src/util/commands/types.js";

interface CLISpec {
  $schema: string;
  name: string;
  version: string;
  description: string;
  commands: Command[];
}

const spec: CLISpec = {
  $schema: "https://supabase.com/schemas/cli-spec.json",
  name: "supa",
  version: "0.0.1",
  description: "Supabase DX CLI - experimental developer experience tools",
  commands: commandSpecs as Command[],
};

console.log(JSON.stringify(spec, null, 2));
