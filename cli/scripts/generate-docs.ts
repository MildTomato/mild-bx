#!/usr/bin/env npx tsx
/**
 * Generates reference documentation from CLI command definitions.
 * Run with: npx tsx scripts/generate-docs.ts
 */

import { Command } from "commander";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_OUTPUT_DIR = join(
  __dirname,
  "../../apps/docs/content/docs/cli/reference"
);

interface CommandInfo {
  name: string;
  fullName: string;
  description: string;
  options: OptionInfo[];
  subcommands: CommandInfo[];
}

interface OptionInfo {
  short: string | undefined;
  long: string | undefined;
  description: string;
  defaultValue: string | undefined;
  required: boolean;
}

function extractCommandInfo(cmd: Command, parentName = ""): CommandInfo {
  const fullName = parentName ? `${parentName} ${cmd.name()}` : cmd.name();

  const options: OptionInfo[] = cmd.options.map((opt) => ({
    short: opt.short,
    long: opt.long,
    description: opt.description || "",
    defaultValue: opt.defaultValue !== undefined ? String(opt.defaultValue) : undefined,
    required: opt.required || false,
  }));

  const subcommands: CommandInfo[] = cmd.commands.map((sub) =>
    extractCommandInfo(sub, fullName)
  );

  return {
    name: cmd.name(),
    fullName,
    description: cmd.description() || "",
    options,
    subcommands,
  };
}

function generateOptionTable(options: OptionInfo[]): string {
  if (options.length === 0) return "";

  const rows = options.map((opt) => {
    const flags = [opt.short, opt.long].filter(Boolean).join(", ");
    const defaultStr = opt.defaultValue ? ` (default: \`${opt.defaultValue}\`)` : "";
    return `| \`${flags}\` | ${opt.description}${defaultStr} |`;
  });

  return `
## Options

| Flag | Description |
|------|-------------|
${rows.join("\n")}
`;
}

function generateCommandMdx(cmd: CommandInfo, isSubcommand = false): string {
  const title = isSubcommand ? cmd.fullName : cmd.name;
  const heading = isSubcommand ? "##" : "#";

  let content = `---
title: "${cmd.fullName}"
description: "${cmd.description}"
---

${cmd.description}

\`\`\`bash
${cmd.fullName} [options]
\`\`\`
${generateOptionTable(cmd.options)}`;

  if (cmd.subcommands.length > 0) {
    content += `
## Subcommands

| Command | Description |
|---------|-------------|
${cmd.subcommands.map((sub) => `| [\`${sub.name}\`](/docs/cli/reference/${sub.fullName.replace(/ /g, "-")}) | ${sub.description} |`).join("\n")}
`;
  }

  return content;
}

function generateIndexMdx(commands: CommandInfo[]): string {
  const rows = commands.map((cmd) => {
    const link = `/docs/cli/reference/${cmd.name}`;
    return `| [\`${cmd.name}\`](${link}) | ${cmd.description} |`;
  });

  return `---
title: Command Reference
description: Complete reference for all CLI commands
---

Auto-generated from CLI source code.

## Commands

| Command | Description |
|---------|-------------|
${rows.join("\n")}
`;
}

function writeCommandDocs(cmd: CommandInfo, isRoot = true) {
  const filename = cmd.fullName.replace(/ /g, "-") + ".mdx";
  const filepath = join(DOCS_OUTPUT_DIR, filename);

  writeFileSync(filepath, generateCommandMdx(cmd, !isRoot));
  console.log(`Generated: ${filename}`);

  // Generate docs for subcommands
  for (const sub of cmd.subcommands) {
    writeCommandDocs(sub, false);
  }
}

function generateMetaJson(commands: CommandInfo[]): string {
  const pages = ["index", ...commands.map((cmd) => cmd.name)];

  // Add subcommand pages
  for (const cmd of commands) {
    for (const sub of cmd.subcommands) {
      pages.push(sub.fullName.replace(/ /g, "-"));
    }
  }

  return JSON.stringify(
    {
      title: "Reference",
      pages,
    },
    null,
    2
  );
}

async function main() {
  // Dynamically import the CLI to get the program
  // We need to mock process.argv to prevent it from parsing
  const originalArgv = process.argv;
  process.argv = ["node", "cli.tsx", "--help"];

  // Create a fresh program for extraction (don't run the actual CLI)
  const program = new Command();

  program
    .name("supa")
    .description("Supabase DX CLI - experimental developer experience tools");

  // Define all commands (mirror from cli.tsx but without actions)
  program
    .command("init")
    .description("Initialize a new supabase project")
    .option("-y, --yes", "Skip prompts and use defaults")
    .option("--org <slug>", "Organization slug")
    .option("--project <ref>", "Link to existing project by ref")
    .option("--name <name>", "Name for new project (requires --org and --region)")
    .option("--region <region>", "Region for new project (e.g., us-east-1)")
    .option("--json", "Output as JSON");

  program
    .command("orgs")
    .description("List organizations")
    .option("--json", "Output as JSON");

  program
    .command("dev")
    .description("Watcher that auto syncs changes to hosted environment [long-running]")
    .option("-p, --profile <name>", "Profile to use")
    .option("--debounce <ms>", "Debounce interval for file changes", "500ms")
    .option("--types-interval <interval>", "Interval for regenerating types", "30s")
    .option("--no-branch-watch", "Disable git branch watching")
    .option("--seed", "Run seed files after schema sync")
    .option("--no-seed", "Disable seeding even if enabled in config")
    .option("--dry-run", "Show what would be synced without applying")
    .option("-v, --verbose", "Show detailed pg-delta logging")
    .option("--json", "Output as JSON (events as newline-delimited JSON)");

  const projects = program
    .command("projects")
    .description("Manage projects");

  projects
    .command("list")
    .description("List all projects")
    .option("--json", "Output as JSON")
    .option("--org <id>", "Filter by organization ID");

  projects
    .command("new")
    .description("Create a new project")
    .option("--org <id>", "Organization ID")
    .option("--region <region>", "Region (e.g., us-east-1)")
    .option("--name <name>", "Project name")
    .option("-y, --yes", "Skip confirmation prompts");

  const project = program
    .command("project")
    .description("Project operations");

  project
    .command("pull")
    .description("Pull remote state to local (remote → local)")
    .option("-p, --profile <name>", "Profile to use")
    .option("--plan", "Show what would happen without making changes")
    .option("--types-only", "Only generate TypeScript types")
    .option("--schemas <schemas>", "Schemas to include for type generation", "public")
    .option("--json", "Output as JSON")
    .option("-v, --verbose", "Show detailed pg-delta logging");

  project
    .command("push")
    .description("Push local changes to remote (local → remote)")
    .option("-p, --profile <name>", "Profile to use")
    .option("--plan", "Show what would happen without making changes")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--migrations-only", "Only apply migrations")
    .option("--config-only", "Only apply config changes")
    .option("--json", "Output as JSON")
    .option("-v, --verbose", "Show detailed pg-delta logging");

  project
    .command("dev")
    .description("Watcher that auto syncs changes to hosted environment [long-running]")
    .option("-p, --profile <name>", "Profile to use")
    .option("--debounce <ms>", "Debounce interval for file changes", "500ms")
    .option("--types-interval <interval>", "Interval for regenerating types", "30s")
    .option("--no-branch-watch", "Disable git branch watching")
    .option("--seed", "Run seed files after schema sync")
    .option("--no-seed", "Disable seeding even if enabled in config")
    .option("--dry-run", "Show what would be synced without applying")
    .option("-v, --verbose", "Show detailed pg-delta logging")
    .option("--json", "Output as JSON");

  project
    .command("seed")
    .description("Run seed files against the database")
    .option("-p, --profile <name>", "Profile to use")
    .option("--dry-run", "Show what would be seeded without applying")
    .option("-v, --verbose", "Show detailed logging")
    .option("--json", "Output as JSON");

  project
    .command("seed-status")
    .description("Show seed configuration and files")
    .option("--json", "Output as JSON");

  project
    .command("api-keys")
    .description("List API keys for the project")
    .option("-p, --profile <name>", "Profile to use")
    .option("--reveal", "Show full API keys (not masked)")
    .option("--json", "Output as JSON");

  project
    .command("profile")
    .description("View or change workflow profile")
    .option("--set <profile>", "Set workflow profile (solo, staged, preview, preview-git)")
    .option("--json", "Output as JSON");

  process.argv = originalArgv;

  // Extract command info
  const rootInfo = extractCommandInfo(program);
  const topLevelCommands = rootInfo.subcommands;

  // Create output directory
  mkdirSync(DOCS_OUTPUT_DIR, { recursive: true });

  // Generate index
  writeFileSync(
    join(DOCS_OUTPUT_DIR, "index.mdx"),
    generateIndexMdx(topLevelCommands)
  );
  console.log("Generated: index.mdx");

  // Generate meta.json
  writeFileSync(
    join(DOCS_OUTPUT_DIR, "meta.json"),
    generateMetaJson(topLevelCommands)
  );
  console.log("Generated: meta.json");

  // Generate command docs
  for (const cmd of topLevelCommands) {
    writeCommandDocs(cmd);
  }

  console.log("\nDocs generated successfully!");
}

main().catch(console.error);
