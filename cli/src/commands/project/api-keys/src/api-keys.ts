/**
 * API Keys command - list project API keys
 */

import chalk from "chalk";
import { createClient, type ApiKey } from "@/lib/api.js";
import { resolveProjectContext, requireTTY } from "@/lib/resolve-project.js";
import * as p from "@clack/prompts";
import { printTable } from "@/components/table.js";

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
      return chalk.red("secret");
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

function printKeysTable(keys: ApiKey[], reveal: boolean) {
  printTable(
    [
      { label: "Name", width: 20, value: (k: ApiKey) => k.name || "-" },
      { label: "Type", width: 15, value: (k: ApiKey) => formatKeyType(k.type) },
      { label: "Key", width: 50, value: (k: ApiKey) => maskApiKey(k.api_key, reveal) },
    ],
    keys,
  );
}

export async function apiKeysCommand(options: ApiKeysOptions): Promise<void> {
  const { projectRef, token } = await resolveProjectContext(options);
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

  requireTTY();

  // Interactive mode
  const spinner = p.spinner();
  spinner.start("Loading API keys...");

  try {
    const client = createClient(token);
    const apiKeys = await client.getProjectApiKeys(projectRef, reveal);

    spinner.stop();

    if (apiKeys.length === 0) {
      console.log(chalk.yellow("No API keys found"));
      return;
    }

    console.log();
    console.log(chalk.bold(`API Keys for ${chalk.cyan(projectRef)}`));
    console.log();
    printKeysTable(apiKeys, reveal);

    if (!reveal) {
      console.log();
      console.log(chalk.dim("Tip: Use --reveal to show full API keys"));
    }
    console.log();
  } catch (error) {
    spinner.stop(chalk.red("Failed to load API keys"));
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
  }
}
