#!/usr/bin/env node
/**
 * Supabase DX CLI - Main entry point
 *
 * Uses declarative command specifications with `arg` for parsing.
 * Replaces the previous Commander.js implementation.
 */

import { existsSync, readFileSync } from "node:fs";
import { getCommand, suggestCommand, commandSpecs } from "@/commands/index.js";
import { renderHelp } from "@/util/commands/help.js";
import type { Command } from "@/util/commands/types.js";
import { getAccessTokenAsync } from "@/lib/config.js";

const CLI_NAME = "supa";
const CLI_VERSION = "0.0.1";
const CLI_DESCRIPTION = "Supabase DX CLI - experimental developer experience tools";

// ─────────────────────────────────────────────────────────────
// Environment setup
// ─────────────────────────────────────────────────────────────

// Load .env files silently
function loadEnvFile(path: string) {
  try {
    if (!existsSync(path)) return;
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        const value = valueParts.join("=").replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

loadEnvFile(".env");
loadEnvFile("supabase/.env");
loadEnvFile(".env.local");

// ─────────────────────────────────────────────────────────────
// Root command definition
// ─────────────────────────────────────────────────────────────

const rootCommand: Command = {
  name: CLI_NAME,
  aliases: [],
  description: CLI_DESCRIPTION,
  arguments: [],
  subcommands: commandSpecs,
  options: [],
  examples: [
    { name: "Initialize a project", value: "supa init" },
    { name: "Start development watcher", value: "supa dev" },
    { name: "Push changes to remote", value: "supa project push" },
    { name: "Pull remote state", value: "supa project pull" },
  ],
};

// ─────────────────────────────────────────────────────────────
// Auth check
// ─────────────────────────────────────────────────────────────

const SKIP_AUTH_COMMANDS = ["init", "help", "login", "logout"];

async function checkAuth(commandName: string): Promise<boolean> {
  if (SKIP_AUTH_COMMANDS.includes(commandName)) {
    return true;
  }

  const token = await getAccessTokenAsync();
  if (!token) {
    console.error("Not logged in. Run `supa login` or set SUPABASE_ACCESS_TOKEN environment variable.");
    console.error("Get a token at: https://supabase.com/dashboard/account/tokens");
    return false;
  }

  // Set env var so commands can use it
  process.env.SUPABASE_ACCESS_TOKEN = token;
  return true;
}

// ─────────────────────────────────────────────────────────────
// Main router
// ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  // Handle --version early (can appear anywhere)
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(CLI_VERSION);
    return 0;
  }

  // Internal demo modes
  if (argv.includes("--wizard-demo")) {
    const { runWizardDemo } = await import("@/components/WizardDemo.js");
    runWizardDemo();
    return 0;
  }

  // Find the command name (first non-flag argument)
  const commandIndex = argv.findIndex((arg) => !arg.startsWith("-"));
  const commandName = commandIndex >= 0 ? argv[commandIndex] : undefined;

  // Check if --help appears before any command (root help)
  const helpIndex = argv.findIndex((arg) => arg === "--help" || arg === "-h");
  const showRootHelp =
    !commandName || (helpIndex >= 0 && (commandIndex < 0 || helpIndex < commandIndex));

  if (showRootHelp) {
    renderHelp(rootCommand, {
      isRoot: true,
      footer: "Tip for AI agents: Most commands support --json for machine-readable output.",
    });
    return 0;
  }

  // Build remaining args for the command (everything after command name)
  const rest = argv.slice(commandIndex + 1);

  // Find command
  const command = getCommand(commandName!);

  if (!command) {
    console.error(`Unknown command: ${commandName}`);

    const suggestions = suggestCommand(commandName);
    if (suggestions.length > 0) {
      console.error(`Did you mean: ${suggestions.join(", ")}?`);
    }

    console.error(`\nRun '${CLI_NAME} --help' for usage.`);
    return 1;
  }

  // Check auth (skip for --help on any command)
  if (!rest.includes("--help") && !rest.includes("-h")) {
    if (!(await checkAuth(commandName))) {
      return 1;
    }
  }

  // Run command handler
  try {
    const exitCode = await command.handler(rest);
    return exitCode ?? 0;
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }
}

// Run
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  });
