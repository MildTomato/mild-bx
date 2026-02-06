/**
 * Help rendering using chalk
 */

import chalk from "chalk";
import { globalCommandOptions } from "./arg-common.js";
import type { Command, CommandOption } from "./types.js";
import { loadProjectConfig, getProfileOrAuto, getProjectRef } from "@/lib/config.js";
import { getCurrentBranch } from "@/lib/git.js";

const CLI_NAME = "supa";

/**
 * Build usage string from command spec
 */
function buildUsage(command: Command, parent?: Command, isRoot?: boolean): string {
  const parts: string[] = [CLI_NAME];

  if (parent) {
    parts.push(parent.name);
  }

  if (!isRoot) {
    parts.push(command.name);
  }

  // Add arguments
  const args = [...command.arguments];

  // If there are subcommands but no explicit arguments, add implicit [command]
  if (args.length === 0 && command.subcommands && command.subcommands.length > 0) {
    const hasDefault = command.subcommands.some((sub) => sub.default);
    args.push({
      name: "command",
      required: isRoot ? false : !hasDefault,
    });
  }

  for (const arg of args) {
    let name = arg.name;
    if (arg.multiple) {
      name += "...";
    }
    parts.push(arg.required ? `<${name}>` : `[${name}]`);
  }

  if (command.options.length > 0) {
    parts.push("[options]");
  }

  return parts.join(" ");
}

/**
 * Convert CommandOption to help format
 */
function convertOptions(options: ReadonlyArray<CommandOption>): Array<{
  short?: string;
  long: string;
  description: string;
  argument?: string;
}> {
  return options
    .filter((opt) => !opt.deprecated && opt.description !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((opt) => ({
      short: opt.shorthand ? `-${opt.shorthand}` : undefined,
      long: `--${opt.name}`,
      description: opt.description || "",
      argument: opt.argument ? `<${opt.argument}>` : undefined,
    }));
}

/**
 * Convert subcommands to help format
 */
function convertCommands(subcommands?: ReadonlyArray<Command>): Array<{
  name: string;
  description: string;
}> {
  if (!subcommands) return [];

  return subcommands
    .filter((cmd) => !cmd.hidden)
    .map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
}

/**
 * Convert examples to help format
 */
function convertExamples(command: Command): string[] {
  if (!command.examples || command.examples.length === 0) {
    return [];
  }

  const result: string[] = [];
  for (const example of command.examples) {
    const values = Array.isArray(example.value) ? example.value : [example.value];
    for (const value of values) {
      result.push(`${example.name}: ${value}`);
    }
  }
  return result;
}

interface ProjectContext {
  projectRef?: string;
  branch: string;
  profileName?: string;
}

/**
 * Get current project context
 */
function getContext(): ProjectContext | null {
  const cwd = process.cwd();
  const config = loadProjectConfig(cwd);

  if (!config) {
    return null;
  }

  const branch = getCurrentBranch(cwd) || "unknown";
  const profile = getProfileOrAuto(config, undefined, branch);
  const projectRef = getProjectRef(config, profile);

  return {
    projectRef,
    branch,
    profileName: profile?.name,
  };
}

export interface RenderHelpOptions {
  parent?: Command;
  isRoot?: boolean;
  showContext?: boolean;
  footer?: string;
}

/**
 * Render help for a command using chalk
 */
export function renderHelp(command: Command, options: RenderHelpOptions = {}): void {
  console.log(help(command, options));
}

/**
 * Generate help text as string
 */
export function help(command: Command, options: RenderHelpOptions = {}): string {
  const usage = buildUsage(command, options.parent, options.isRoot);
  const allOptions = [...command.options, ...globalCommandOptions];
  const lines: string[] = [];

  lines.push("");

  // Context
  if (options.showContext !== false) {
    const ctx = getContext();
    if (ctx === null) {
      lines.push(chalk.dim("No project configured. Run `supa init` to get started."));
      lines.push("");
    } else if (ctx) {
      if (ctx.projectRef) {
        lines.push(`${chalk.dim("Project:")}    ${chalk.cyan(ctx.projectRef)}`);
      }
      lines.push(`${chalk.dim("Git Branch:")} ${chalk.yellow(ctx.branch)}`);
      if (ctx.profileName) {
        lines.push(`${chalk.dim("Profile:")}    ${chalk.cyan(ctx.profileName)}`);
      }
      lines.push("");
    }
  }

  // Usage
  lines.push(`${chalk.bold("Usage:")} ${usage}`);
  lines.push("");

  // Description
  lines.push(command.description);
  lines.push("");

  // Commands
  const cmds = convertCommands(command.subcommands);
  if (cmds.length > 0) {
    lines.push(chalk.bold("Commands:"));
    const maxLen = Math.max(...cmds.map((c) => c.name.length));
    for (const cmd of cmds) {
      const padding = " ".repeat(maxLen - cmd.name.length + 2);
      lines.push(`  ${chalk.cyan(cmd.name)}${padding}${chalk.dim(cmd.description)}`);
    }
    lines.push("");
  }

  // Options
  const opts = convertOptions(allOptions);
  if (opts.length > 0) {
    lines.push(chalk.bold("Options:"));
    const maxLen = Math.max(
      ...opts.map((o) => {
        const flags = [o.short, o.long].filter(Boolean).join(", ");
        return flags.length + (o.argument ? o.argument.length + 1 : 0);
      })
    );
    for (const opt of opts) {
      const flags = [opt.short, opt.long].filter(Boolean).join(", ");
      const label = flags + (opt.argument ? ` ${opt.argument}` : "");
      const padding = " ".repeat(maxLen - label.length + 2);
      lines.push(`  ${chalk.green(label)}${padding}${chalk.dim(opt.description)}`);
    }
    lines.push("");
  }

  // Examples
  const examples = convertExamples(command);
  if (examples.length > 0) {
    lines.push(chalk.bold("Examples:"));
    for (const ex of examples) {
      lines.push(`  ${chalk.dim(ex)}`);
    }
    lines.push("");
  }

  // Footer
  if (options.footer) {
    lines.push(chalk.dim(options.footer));
    lines.push("");
  }

  return lines.join("\n");
}
