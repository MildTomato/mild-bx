/**
 * CLI Spec - Extracts a machine-readable specification from a Commander program.
 * Similar to OpenAPI for REST APIs, but for CLI commands.
 */

import { Command, Option } from "commander";

export interface CLISpec {
  $schema: string;
  name: string;
  version: string;
  description: string;
  commands: CommandSpec[];
}

export interface CommandSpec {
  name: string;
  fullName: string;
  description: string;
  usage?: string;
  options: OptionSpec[];
  arguments: ArgumentSpec[];
  subcommands: CommandSpec[];
}

export interface OptionSpec {
  name: string;
  short?: string;
  long?: string;
  description: string;
  required: boolean;
  variadic: boolean;
  defaultValue?: unknown;
  choices?: string[];
  env?: string;
}

export interface ArgumentSpec {
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
  defaultValue?: unknown;
}

function extractOption(opt: Option): OptionSpec {
  return {
    name: opt.attributeName(),
    short: opt.short,
    long: opt.long,
    description: opt.description || "",
    required: opt.required || false,
    variadic: opt.variadic || false,
    defaultValue: opt.defaultValue,
    choices: opt.argChoices,
    env: opt.envVar,
  };
}

function extractCommand(cmd: Command, parentName = ""): CommandSpec {
  const fullName = parentName ? `${parentName} ${cmd.name()}` : cmd.name();

  // Extract arguments
  const args: ArgumentSpec[] = (cmd as any)._args?.map((arg: any) => ({
    name: arg.name,
    description: arg.description || "",
    required: arg.required,
    variadic: arg.variadic,
    defaultValue: arg.defaultValue,
  })) || [];

  // Extract options
  const options = cmd.options.map(extractOption);

  // Extract subcommands recursively
  const subcommands = cmd.commands.map((sub) => extractCommand(sub, fullName));

  return {
    name: cmd.name(),
    fullName,
    description: cmd.description() || "",
    usage: cmd.usage(),
    options,
    arguments: args,
    subcommands,
  };
}

/**
 * Extract a full CLI specification from a Commander program.
 */
export function extractCLISpec(program: Command): CLISpec {
  const rootSpec = extractCommand(program);

  return {
    $schema: "https://supabase.com/schemas/cli-spec.json",
    name: program.name(),
    version: program.version() || "0.0.0",
    description: program.description() || "",
    commands: rootSpec.subcommands,
  };
}

/**
 * Generate markdown documentation from a CLI spec.
 */
export function specToMarkdown(spec: CLISpec): string {
  let md = `# ${spec.name}\n\n`;
  md += `${spec.description}\n\n`;
  md += `Version: ${spec.version}\n\n`;
  md += `## Commands\n\n`;

  function renderCommand(cmd: CommandSpec, depth = 0): string {
    const indent = "  ".repeat(depth);
    let content = "";

    if (depth === 0) {
      content += `### \`${cmd.fullName}\`\n\n`;
    } else {
      content += `${indent}#### \`${cmd.fullName}\`\n\n`;
    }

    content += `${cmd.description}\n\n`;

    if (cmd.options.length > 0) {
      content += `**Options:**\n\n`;
      content += `| Flag | Description | Default |\n`;
      content += `|------|-------------|----------|\n`;
      for (const opt of cmd.options) {
        const flags = [opt.short, opt.long].filter(Boolean).join(", ");
        const def = opt.defaultValue !== undefined ? `\`${opt.defaultValue}\`` : "-";
        content += `| \`${flags}\` | ${opt.description} | ${def} |\n`;
      }
      content += "\n";
    }

    for (const sub of cmd.subcommands) {
      content += renderCommand(sub, depth + 1);
    }

    return content;
  }

  for (const cmd of spec.commands) {
    md += renderCommand(cmd);
  }

  return md;
}
