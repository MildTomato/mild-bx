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
 * Get the URL path for a command
 */
function getCommandPath(command: Command, parent?: Command, parentPath?: string): string {
  if (parentPath) {
    return `${parentPath}/${command.name}`;
  }
  return parent ? `${parent.name}/${command.name}` : command.name;
}

/**
 * Get the docs directory path for a command.
 * parentPath resolves deeply nested commands (for example, project/env/pull).
 */
function getDocsDir(command: Command, parent?: Command, parentPath?: string): string {
  if (parentPath) {
    return join(COMMANDS_DIR, ...parentPath.split("/"), command.name, "docs");
  }
  if (parent) {
    return join(COMMANDS_DIR, parent.name, command.name, "docs");
  }
  return join(COMMANDS_DIR, command.name, "docs");
}

/**
 * Read a markdown file from the docs directory if it exists
 */
function readDocFile(command: Command, parent: Command | undefined, filename: string, parentPath?: string): string | null {
  const docsDir = getDocsDir(command, parent, parentPath);
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
 * @param depth - Depth level (0 = top-level command, 1 = direct subcommand, 2+ = nested)
 */
function commandToMdx(command: Command, parent?: Command, parentPath?: string, depth: number = 0): string {
  const fullName = parentPath ? `${parentPath.replace(/\//g, ' ')} ${command.name}` : parent ? `${parent.name} ${command.name}` : command.name;
  const title = `supa ${fullName}`;

  const lines: string[] = [
    "---",
    `title: "${title}"`,
    `description: "${command.description}"`,
    "generated: true",
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
      let desc = arg.description || "";
      if (arg.multiple && desc) {
        desc += " (can be repeated)";
      } else if (arg.multiple) {
        desc = "(can be repeated)";
      }
      lines.push(`| \`${arg.name}\` | ${arg.required ? "Yes" : "No"} | ${desc} |`);
    }
    lines.push("");
  }

  // Subcommands - from spec
  if (command.subcommands && command.subcommands.length > 0) {
    const visibleSubs = command.subcommands.filter((s) => !s.hidden);
    if (visibleSubs.length > 0) {
      // If we're at depth 1+, inline subcommands as sections instead of linking to separate pages
      const shouldInline = depth >= 1;

      if (shouldInline) {
        // Inline documentation for each subcommand
        lines.push("## Commands", "");
        lines.push("The following commands are available:", "");

        // Add simple list for navigation
        for (const sub of visibleSubs) {
          lines.push(`- [\`${sub.name}\`](#${sub.name}) - ${sub.description}`);
        }
        lines.push("", "---", "");

        // Build the filesystem path for resolving subcommand docs/
        const commandFsPath = parentPath
          ? `${parentPath}/${command.name}`
          : parent
            ? `${parent.name}/${command.name}`
            : command.name;

        // Full documentation for each subcommand
        for (let i = 0; i < visibleSubs.length; i++) {
          const sub = visibleSubs[i];
          const subFullName = `${fullName} ${sub.name}`;
          const subUsageArgs = sub.arguments.map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`)).join(" ");
          const subHasOptions = sub.options.length > 0;
          const subUsage = `supa ${subFullName}${subUsageArgs ? ` ${subUsageArgs}` : ""}${subHasOptions ? " [options]" : ""}`;

          lines.push(`### \`${sub.name}\``, "");
          lines.push(sub.description, "");

          // Intro prose from docs/intro.md
          const subIntro = readDocFile(sub, command, "intro.md", commandFsPath);
          if (subIntro) {
            lines.push("", subIntro, "");
          }

          lines.push("```bash", subUsage, "```", "");

          // Arguments for subcommand (use table)
          if (sub.arguments.length > 0) {
            lines.push("**Arguments:**", "");
            lines.push("| Argument | Required | Description |");
            lines.push("|----------|----------|-------------|");
            for (const arg of sub.arguments) {
              let desc = arg.description || "";
              if (arg.multiple && desc) {
                desc += " (can be repeated)";
              } else if (arg.multiple) {
                desc = "(can be repeated)";
              }
              lines.push(`| \`${arg.name}\` | ${arg.required ? "Yes" : "No"} | ${desc} |`);
            }
            lines.push("");
          }

          // Options for subcommand (use table)
          const subVisibleOptions = sub.options.filter((opt) => !opt.deprecated && opt.description !== undefined);
          if (subVisibleOptions.length > 0) {
            lines.push("**Options:**", "");
            lines.push("| Option | Type | Description |");
            lines.push("|--------|------|-------------|");
            for (const opt of subVisibleOptions) {
              const flag = opt.shorthand ? `-${opt.shorthand}, --${opt.name}` : `--${opt.name}`;
              const typeStr = getTypeString(opt.type);
              const argStr = opt.argument ? ` <${opt.argument}>` : "";
              lines.push(`| \`${flag}${argStr}\` | ${typeStr} | ${opt.description} |`);
            }
            lines.push("");

            // Option details from docs/option.<name>.md
            for (const opt of subVisibleOptions) {
              const optionDoc = readDocFile(sub, command, `option.${opt.name}.md`, commandFsPath);
              if (optionDoc) {
                lines.push(`**\`--${opt.name}\`**`, "");
                lines.push(optionDoc, "");
              }
            }
          }

          // Examples for subcommand
          if (sub.examples && sub.examples.length > 0) {
            lines.push("**Examples:**", "");
            for (const example of sub.examples) {
              const exampleSlug = slugify(example.name);

              // Check for extra docs/example.<slug>.md content
              const exampleDoc = readDocFile(sub, command, `example.${exampleSlug}.md`, commandFsPath);
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

          // Add horizontal rule between subcommands
          if (i < visibleSubs.length - 1) {
            lines.push("---", "");
          }
        }
      } else {
        // Table with links to separate pages (depth 0 behavior)
        lines.push("## Subcommands", "");
        lines.push("| Command | Description |");
        lines.push("|---------|-------------|");
        for (const sub of visibleSubs) {
          // Build full path for nested commands
          const currentPath = parentPath ? `${parentPath}/${command.name}` : parent ? `${parent.name}/${command.name}` : command.name;
          const subPath = getCommandPath(sub, command, currentPath);
          lines.push(`| [\`${sub.name}\`](/docs/cli/reference/${subPath}) | ${sub.description} |`);
        }
        lines.push("");
      }
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
function writeCommandDoc(command: Command, parent?: Command, parentPath?: string, depth: number = 0): void {
  const hasSubcommands = command.subcommands && command.subcommands.length > 0;
  const docsDir = getDocsDir(command, parent, parentPath);
  const hasDocsDir = existsSync(docsDir);

  // Skip file creation for depth 2+ commands - they're inlined in parent
  if (depth >= 2) {
    return;
  }

  let filePath: string;
  let displayPath: string;

  // Check if subcommands will be inlined (depth >= 1 means subcommands are at depth 2+ and get inlined)
  const willInlineSubcommands = hasSubcommands && depth >= 1;

  if (hasSubcommands && !willInlineSubcommands) {
    // Command with subcommands that will be separate pages: create folder, use index.mdx
    const fullPath = parent ? `${parentPath || parent.name}/${command.name}` : command.name;
    filePath = join(DOCS_OUTPUT_DIR, fullPath, "index.mdx");
    displayPath = `${fullPath}/index.mdx`;
  } else if (parent) {
    // Leaf subcommand or command with inlined subcommands: single .mdx file in parent's folder
    const fullParentPath = parentPath || parent.name;
    filePath = join(DOCS_OUTPUT_DIR, fullParentPath, `${command.name}.mdx`);
    displayPath = `${fullParentPath}/${command.name}.mdx`;
  } else {
    // Top-level command without subcommands
    filePath = join(DOCS_OUTPUT_DIR, `${command.name}.mdx`);
    displayPath = `${command.name}.mdx`;
  }

  mkdirSync(dirname(filePath), { recursive: true });

  const content = commandToMdx(command, parent, parentPath, depth);
  writeFileSync(filePath, content);

  console.log(`  ${displayPath}${hasDocsDir ? " (+docs/)" : ""}`);

  // Write meta.json only for top-level folders with subcommands
  // Nested folders let Fumadocs auto-detect children from index.mdx + sibling .mdx files
  if (hasSubcommands && !parent) {
    const visibleSubs = command.subcommands!.filter((s) => !s.hidden);
    // Title case the command name (handle hyphenated names properly)
    const title = command.name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    const folderMeta = {
      title,
      pages: ["index", ...visibleSubs.map((s) => s.name)],
    };
    const fullParentPath = parentPath || parent?.name || "";
    const commandPath = parent ? `${fullParentPath}/${command.name}` : command.name;
    const commandDir = join(DOCS_OUTPUT_DIR, commandPath);
    if (!existsSync(commandDir)) {
      mkdirSync(commandDir, { recursive: true });
    }
    const metaPath = join(commandDir, "meta.json");
    writeFileSync(metaPath, JSON.stringify(folderMeta, null, 2) + "\n");
    console.log(`  ${commandPath}/meta.json`);
  }

  // Process subcommands recursively (pass the full path for nested commands)
  if (command.subcommands) {
    const currentPath = parentPath ? `${parentPath}/${command.name}` : parent ? `${parent.name}/${command.name}` : command.name;
    for (const sub of command.subcommands) {
      if (!sub.hidden) {
        writeCommandDoc(sub, command, currentPath, depth + 1);
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
    "generated: true",
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

/**
 * Generate meta.json for sidebar organization
 * Top-level commands only - folders handle their own subcommands
 */
function writeMetaJson(): void {
  const filePath = join(DOCS_OUTPUT_DIR, "meta.json");

  const pages: string[] = ["index"];

  for (const cmd of commandSpecs) {
    if (cmd.hidden) continue;

    if (cmd.subcommands?.length) {
      // Add separator header then spread folder contents
      const title = cmd.name.charAt(0).toUpperCase() + cmd.name.slice(1);
      pages.push(`---${title}---`);
      pages.push(`...${cmd.name}`);
    } else {
      pages.push(cmd.name);
    }
  }

  const meta = { pages };
  writeFileSync(filePath, JSON.stringify(meta, null, 2) + "\n");
  console.log("  meta.json");
}

// Main
console.log("Generating CLI docs from command specs...");
console.log("");

if (!existsSync(DOCS_OUTPUT_DIR)) {
  mkdirSync(DOCS_OUTPUT_DIR, { recursive: true });
}

writeMetaJson();
writeIndexDoc();

for (const command of commandSpecs) {
  writeCommandDoc(command);
}

console.log("");
console.log("Done!");
