#!/usr/bin/env tsx
/**
 * Generate MDX documentation from CLI command specs
 *
 * Extracts structure from command specs and merges with optional markdown files:
 *   docs/intro.md              - Intro prose at the top
 *   docs/option.<name>.md      - Extra content for a specific option
 *   docs/example.<slug>.md     - Extra content for a specific example
 *
 * Usage:
 *   pnpm docs:generate
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { commandSpecs } from "../src/commands/index.js";
import type { Command, CommandOption } from "../src/util/commands/types.js";

const DOCS_OUTPUT_DIR = join(process.cwd(), "..", "apps", "docs", "content", "docs", "cli", "reference");
const COMMANDS_DIR = join(process.cwd(), "src", "commands");

/**
 * Get the docs slug for a command
 */
function getCommandSlug(command: Command, parent?: Command): string {
  return parent ? `${parent.name}-${command.name}` : command.name;
}

/**
 * Get the docs directory path for a command
 */
function getDocsDir(command: Command, parent?: Command): string {
  if (parent) {
    return join(COMMANDS_DIR, parent.name, command.name, "docs");
  }
  return join(COMMANDS_DIR, command.name, "docs");
}

/**
 * Read a markdown file from the docs directory if it exists
 */
function readDocFile(command: Command, parent: Command | undefined, filename: string): string | null {
  const docsDir = getDocsDir(command, parent);
  const filePath = join(docsDir, filename);
  if (existsSync(filePath)) {
    return readFileSync(filePath, "utf-8").trim();
  }
  return null;
}

/**
 * Slugify a string for matching filenames
 */
function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Get a human-readable type string
 */
function getTypeString(type: CommandOption["type"]): string {
  if (Array.isArray(type)) {
    return `${getTypeString(type[0])}[]`;
  }
  if (type === String) return "string";
  if (type === Boolean) return "boolean";
  if (type === Number) return "number";
  return "unknown";
}

/**
 * Convert a command spec to MDX content
 */
function commandToMdx(command: Command, parent?: Command): string {
  const fullName = parent ? `${parent.name} ${command.name}` : command.name;
  const title = `supa ${fullName}`;

  const lines: string[] = [
    "---",
    `title: "${title}"`,
    `description: "${command.description}"`,
    "---",
    "",
  ];

  // Intro prose (from docs/intro.md or command.longDescription)
  const intro = readDocFile(command, parent, "intro.md");
  if (intro) {
    lines.push(intro, "");
  } else if (command.longDescription) {
    lines.push(command.longDescription, "");
  }

  // Usage - always generated from spec
  const usageArgs = command.arguments
    .map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`))
    .join(" ");
  const hasOptions = command.options.length > 0;
  const usage = `supa ${fullName}${usageArgs ? ` ${usageArgs}` : ""}${hasOptions ? " [options]" : ""}`;

  lines.push("## Usage", "", "```bash", usage, "```", "");

  // Arguments - from spec
  if (command.arguments.length > 0) {
    lines.push("## Arguments", "");
    lines.push("| Argument | Required | Description |");
    lines.push("|----------|----------|-------------|");
    for (const arg of command.arguments) {
      const desc = arg.multiple ? "(can be repeated)" : "";
      lines.push(`| \`${arg.name}\` | ${arg.required ? "Yes" : "No"} | ${desc} |`);
    }
    lines.push("");
  }

  // Subcommands - from spec
  if (command.subcommands && command.subcommands.length > 0) {
    const visibleSubs = command.subcommands.filter((s) => !s.hidden);
    if (visibleSubs.length > 0) {
      lines.push("## Subcommands", "");
      lines.push("| Command | Description |");
      lines.push("|---------|-------------|");
      for (const sub of visibleSubs) {
        const subSlug = getCommandSlug(sub, command);
        lines.push(`| [\`${sub.name}\`](/docs/cli/reference/${subSlug}) | ${sub.description} |`);
      }
      lines.push("");
    }
  }

  // Options - from spec
  const visibleOptions = command.options.filter(
    (opt) => !opt.deprecated && opt.description !== undefined
  );

  if (visibleOptions.length > 0) {
    lines.push("## Options", "");
    lines.push("| Option | Type | Description |");
    lines.push("|--------|------|-------------|");
    for (const opt of visibleOptions) {
      const flag = opt.shorthand
        ? `-${opt.shorthand}, --${opt.name}`
        : `--${opt.name}`;
      const typeStr = getTypeString(opt.type);
      const argStr = opt.argument ? ` <${opt.argument}>` : "";
      lines.push(`| \`${flag}${argStr}\` | ${typeStr} | ${opt.description} |`);
    }
    lines.push("");

    // Option details from docs/option.<name>.md
    for (const opt of visibleOptions) {
      const optionDoc = readDocFile(command, parent, `option.${opt.name}.md`);
      if (optionDoc) {
        lines.push(`### \`--${opt.name}\``, "");
        lines.push(optionDoc, "");
      }
    }
  }

  // Examples - from spec
  if (command.examples && command.examples.length > 0) {
    lines.push("## Examples", "");
    for (const example of command.examples) {
      const exampleSlug = slugify(example.name);
      lines.push(`### ${example.name}`, "");

      // Check for extra docs/example.<slug>.md content (before code block)
      const exampleDoc = readDocFile(command, parent, `example.${exampleSlug}.md`);
      if (exampleDoc) {
        lines.push(exampleDoc, "");
      }

      const values = Array.isArray(example.value) ? example.value : [example.value];
      lines.push("```bash");
      for (const value of values) {
        lines.push(value);
      }
      lines.push("```", "");
    }
  }

  return lines.join("\n");
}

/**
 * Write MDX file for a command
 */
function writeCommandDoc(command: Command, parent?: Command): void {
  const slug = getCommandSlug(command, parent);
  const filePath = join(DOCS_OUTPUT_DIR, `${slug}.mdx`);

  mkdirSync(dirname(filePath), { recursive: true });

  const content = commandToMdx(command, parent);
  writeFileSync(filePath, content);

  const docsDir = getDocsDir(command, parent);
  const hasDocsDir = existsSync(docsDir);
  console.log(`  ${slug}.mdx${hasDocsDir ? " (+docs/)" : ""}`);

  // Process subcommands recursively
  if (command.subcommands) {
    for (const sub of command.subcommands) {
      if (!sub.hidden) {
        writeCommandDoc(sub, command);
      }
    }
  }
}

/**
 * Generate index page
 */
function writeIndexDoc(): void {
  const filePath = join(DOCS_OUTPUT_DIR, "index.mdx");

  const lines: string[] = [
    "---",
    'title: "CLI Reference"',
    'description: "Complete reference for all supa CLI commands"',
    "---",
    "",
    "Complete reference for all `supa` CLI commands.",
    "",
    "## Commands",
    "",
    "| Command | Description |",
    "|---------|-------------|",
  ];

  for (const cmd of commandSpecs) {
    if (cmd.hidden) continue;
    lines.push(`| [\`${cmd.name}\`](/docs/cli/reference/${cmd.name}) | ${cmd.description} |`);
  }

  lines.push("");
  writeFileSync(filePath, lines.join("\n"));
  console.log("  index.mdx");
}

// Main
console.log("Generating CLI docs from command specs...");
console.log("");

if (!existsSync(DOCS_OUTPUT_DIR)) {
  mkdirSync(DOCS_OUTPUT_DIR, { recursive: true });
}

writeIndexDoc();

for (const command of commandSpecs) {
  writeCommandDoc(command);
}

console.log("");
console.log("Done!");
