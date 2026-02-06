/**
 * API Keys command - list project API keys
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient, type ApiKey } from "@/lib/api.js";
import {
  getAccessToken,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
} from "@/lib/config.js";
import { getCurrentBranch } from "@/lib/git.js";
import { createSpinner } from "@/lib/spinner.js";

interface ApiKeysOptions {
  profile?: string;
  json?: boolean;
  reveal?: boolean;
}

function formatKeyType(type: string | null | undefined): string {
  if (!type) return "unknown";
  switch (type) {
    case "legacy":
      return chalk.dim("legacy");
    case "publishable":
      return chalk.green("publishable");
    case "secret":
      return chalk.yellow("secret");
    default:
      return type;
  }
}

function maskApiKey(key: string | null | undefined, reveal: boolean): string {
  if (!key) return "-";
  if (reveal) return key;
  if (key.length > 24) {
    return key.slice(0, 20) + "..." + key.slice(-4);
  }
  return key;
}

function printTable(keys: ApiKey[], reveal: boolean) {
  const nameW = 20;
  const typeW = 15;
  const keyW = 50;

  // Header
  console.log(
    chalk.bold.cyan("Name".padEnd(nameW)) +
    chalk.bold.cyan("Type".padEnd(typeW)) +
    chalk.bold.cyan("Key".padEnd(keyW))
  );
  console.log(chalk.dim("─".repeat(nameW + typeW + keyW)));

  // Rows
  for (const k of keys) {
    console.log(
      (k.name || "-").slice(0, nameW - 1).padEnd(nameW) +
      formatKeyType(k.type).padEnd(typeW + 10) + // extra for ANSI codes
      maskApiKey(k.api_key, reveal)
    );
  }
}

export async function apiKeysCommand(options: ApiKeysOptions): Promise<void> {
  const token = getAccessToken();

  if (!token) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "Not logged in" }));
    } else {
      console.error(chalk.red("Not logged in. Set SUPABASE_ACCESS_TOKEN."));
    }
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const config = loadProjectConfig(cwd);

  if (!config) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "No config found" }));
    } else {
      console.error(chalk.red("No supabase/config.json found. Run `supa init` first."));
    }
    process.exitCode = 1;
    return;
  }

  const branch = getCurrentBranch(cwd) || "main";
  const profile = getProfileOrAuto(config, options.profile, branch);
  const projectRef = getProjectRef(config, profile);

  if (!projectRef) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "No project ref" }));
    } else {
      console.error(chalk.red("No project ref configured. Run `supa init` first."));
    }
    process.exitCode = 1;
    return;
  }

  const reveal = options.reveal ?? false;

  // JSON mode
  if (options.json) {
    try {
      const client = createClient(token);
      const apiKeys = await client.getProjectApiKeys(projectRef, reveal);
      console.log(JSON.stringify({ status: "success", project_ref: projectRef, api_keys: apiKeys }));
    } catch (error) {
      console.log(JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load API keys",
      }));
    }
    return;
  }

  // Non-TTY check for interactive mode
  if (!process.stdin.isTTY) {
    console.error("Error: Interactive mode requires a TTY.");
    console.error("Use --json for non-interactive output.");
    process.exitCode = 1;
    return;
  }

  // Interactive mode
  const spinner = createSpinner();
  spinner.start("Loading API keys...");

  try {
    const client = createClient(token);
    const apiKeys = await client.getProjectApiKeys(projectRef, reveal);

    if (apiKeys.length === 0) {
      spinner.stop(chalk.yellow("No API keys found"));
      return;
    }

    spinner.stop(`API Keys for ${chalk.cyan(projectRef)}`);
    console.log();
    printTable(apiKeys, reveal);

    if (!reveal) {
      console.log();
      console.log(chalk.dim("Tip: Use --reveal to show full API keys"));
    }
  } catch (error) {
    spinner.stop(chalk.red("Failed to load API keys"));
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
  }
}
