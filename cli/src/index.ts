#!/usr/bin/env node
/**
 * Supabase DX CLI - Main entry point
 *
 * Uses declarative command specifications with `arg` for parsing.
 * Replaces the previous Commander.js implementation.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";


import { getCommand, suggestCommand, commandSpecs } from "@/commands/index.js";
import { renderHelp } from "@/util/commands/help.js";
import type { Command } from "@/util/commands/types.js";
import { getAccessTokenAsync } from "@/lib/config.js";
import { SUPABASE_DASHBOARD_URL } from "@/lib/env.js";
import { C } from "@/lib/colors.js";
import { printUpdateNotice } from "@/lib/update-notice.js";

const CLI_NAME = "supa";
const CLI_VERSION = "0.0.1";
const CLI_DESCRIPTION = "Supabase DX CLI - experimental developer experience tools";

// ─────────────────────────────────────────────────────────────
// Environment setup
// ─────────────────────────────────────────────────────────────

// Load .env files silently (or verbosely if verbose flag is set)
function loadEnvFile(path: string, verbose = false) {
  try {
    const fullPath = join(process.cwd(), path);
    if (verbose) {
      console.error(`${C.secondary}[env] Checking ${fullPath}${C.reset}`);
    }
    if (!existsSync(fullPath)) {
      if (verbose) {
        console.error(`${C.secondary}[env] File does not exist${C.reset}`);
      }
      return;
    }
    const content = readFileSync(fullPath, "utf-8");
    let loaded = 0;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        const value = valueParts.join("=").replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = value;
          loaded++;
        }
      }
    }
    if (verbose && loaded > 0) {
      console.error(`${C.secondary}[env] Loaded ${loaded} variables from ${fullPath}${C.reset}`);
    }
  } catch (err) {
    // Always show errors (in red)
    console.error(`${C.error}[env] Failed to load ${path}:${C.reset}`, err);
  }
}

// Note: .env loading moved to main() function so it runs at command execution time,
// not module init time (which doesn't work correctly in compiled binaries)

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

const SKIP_AUTH_COMMANDS = ["init", "bootstrap", "help", "login", "logout"];

async function checkAuth(commandName: string): Promise<boolean> {
  if (SKIP_AUTH_COMMANDS.includes(commandName)) {
    return true;
  }

  let token = await getAccessTokenAsync();

  if (!token) {
    if (process.stdin.isTTY) {
      // Pit of success: run login inline then continue with the original command
      const { loginCommand } = await import("./commands/login/src/login.js");
      await loginCommand({ reason: "You need to be logged in to run this command." });
      token = await getAccessTokenAsync();
      if (!token) {
        // loginCommand already printed the failure reason
        return false;
      }
    } else {
      console.error("Not logged in. Set SUPABASE_ACCESS_TOKEN or run `supa login`.");
      return false;
    }
  }

  // Set env var so commands can use it
  process.env.SUPABASE_ACCESS_TOKEN = token;
  return true;
}

// ─────────────────────────────────────────────────────────────
// Main router
// ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  let argv = process.argv.slice(2);
  const isVerbose = argv.includes("--verbose");

  // Load .env files at runtime (not module init time).
  //
  // Priority (highest → lowest among files; OS env always wins over all files):
  //   .env.local > supabase/.env
  //
  // .env.local is the single source of truth for credentials written by
  // `supa dev` / `supa init` (SUPABASE_DB_PASSWORD, SUPABASE_URL, etc.).
  // supabase/.env holds project-level vars (edge function config, etc.).
  if (isVerbose) {
    console.error(`${C.secondary}[env] cwd: ${process.cwd()}${C.reset}`);
  }
  loadEnvFile(".env.local", isVerbose);     // credentials — written by supa
  loadEnvFile("supabase/.env", isVerbose);  // project-level env vars

  if (isVerbose) {
    const pwd = process.env.SUPABASE_DB_PASSWORD;
    if (pwd) {
      const last4 = pwd.length >= 4 ? pwd.slice(-4) : pwd;
      console.error(`${C.secondary}[env] SUPABASE_DB_PASSWORD last 4 digits: ...${last4}${C.reset}`);
    } else {
      console.error(`${C.secondary}[env] SUPABASE_DB_PASSWORD not set${C.reset}`);
    }
  }

  // --verbose is left in argv so individual commands can parse and use it

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

  // Top padding — all spacing owned here, not in individual commands
  console.log();

  // Check auth (skip for --help on any command)
  if (!rest.includes("--help") && !rest.includes("-h")) {
    if (!(await checkAuth(commandName))) {
      return 1;
    }
  }

  // Run command handler
  try {
    const exitCode = await command.handler(rest);
    console.log(); // bottom padding
    printUpdateNotice();
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
