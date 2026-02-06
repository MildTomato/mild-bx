import * as p from "@clack/prompts";
import chalk from "chalk";
import { requireAuth, loadProjectConfig, getProfileOrAuto, getProjectRef } from "@/lib/config.js";
import { createClient } from "@/lib/api.js";
import { getCurrentBranch } from "@/lib/git.js";
import { printCommandHeader, S_BAR } from "@/components/command-header.js";
import { createSpinner } from "@/lib/spinner.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";
import {
  PROVIDER_DEFINITIONS,
  parseProviderFromRemote,
  maskSecret,
} from "@/lib/auth-providers.js";

export interface ListOptions {
  json?: boolean;
  profile?: string;
}

export async function listAuthProviders(options: ListOptions = {}): Promise<void> {
  const spinner = !options.json ? createSpinner() : null;

  if (!options.json) {
    printCommandHeader({
      command: "supa project auth-provider list",
      description: ["List configured OAuth providers."],
    });
    console.log(S_BAR);
  }

  spinner?.start("Authenticating...");
  const authToken = await requireAuth();
  spinner?.stop("Authenticated");

  // Load config and get project ref (synchronous)
  const cwd = process.cwd();
  const config = loadProjectConfig(cwd);
  if (!config) {
    const errorMsg = "No project config found. Run `supa init` to create one, or cd into a directory with a supabase/ folder.";
    if (options.json) {
      console.error(JSON.stringify({
        error: "ConfigNotFound",
        message: errorMsg,
        exitCode: EXIT_CODES.CONFIG_NOT_FOUND,
      }, null, 2));
    } else {
      p.log.error(errorMsg);
    }
    process.exit(EXIT_CODES.CONFIG_NOT_FOUND);
  }
  const branch = getCurrentBranch(cwd) || "main";
  const profile = getProfileOrAuto(config, options.profile, branch);
  const projectRef = getProjectRef(config, profile);
  if (!projectRef) {
    const errorMsg = "No project ref configured. Run `supa init` to set up your project.";
    if (options.json) {
      console.error(JSON.stringify({
        error: "ProjectRefNotFound",
        message: errorMsg,
        exitCode: EXIT_CODES.CONFIG_NOT_FOUND,
      }, null, 2));
    } else {
      p.log.error(errorMsg);
    }
    process.exit(EXIT_CODES.CONFIG_NOT_FOUND);
  }

  // Fetch remote auth config
  spinner?.start("Fetching providers...");

  let remoteConfig: Record<string, unknown>;
  try {
    const client = createClient(authToken);
    remoteConfig = await client.getAuthConfig(projectRef);

    spinner?.stop("Providers loaded");
  } catch (error) {
    spinner?.stop("Failed to fetch providers");

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (options.json) {
      console.error(JSON.stringify({
        error: "NetworkError",
        message: "Failed to fetch provider configuration",
        details: errorMessage,
        exitCode: EXIT_CODES.NETWORK_ERROR,
      }, null, 2));
    } else {
      p.log.error(`Failed to fetch provider configuration: ${errorMessage}`);
      if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
        p.log.message("\nThis might be a network issue. Check your connection and try again.");
      }
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }

  // Parse providers from remote config
  const providers = PROVIDER_DEFINITIONS.map((provider) => {
    const config = parseProviderFromRemote(provider, remoteConfig);
    return {
      name: provider.displayName,
      key: provider.key,
      enabled: config?.enabled ?? false,
      clientId: config?.client_id,
    };
  }).filter((p) => p.clientId || p.enabled); // Only show configured providers

  if (options.json) {
    console.log(JSON.stringify({
      providers,
      total: providers.length,
    }, null, 2));
    return;
  }

  // Close rail
  console.log(S_BAR);
  console.log(`${chalk.dim("└")}`);
  console.log();

  // Display as table
  if (providers.length === 0) {
    console.log("No OAuth providers configured.");
    console.log();
    console.log(`Run ${chalk.cyan("supa project auth-provider add")} to configure one.`);
    console.log();
    return;
  }

  // Calculate column widths
  const nameWidth = Math.max(
    ...providers.map((p) => p.name.length),
    "NAME".length
  );
  const statusWidth = "STATUS".length;
  const clientIdWidth = Math.max(
    ...providers.map((p) => (p.clientId ? maskSecret(p.clientId).length : 0)),
    "CLIENT ID".length
  );

  // Print header (don't pad the last column)
  const header = `${chalk.dim("NAME".padEnd(nameWidth))}  ${chalk.dim("STATUS".padEnd(statusWidth))}  ${chalk.dim("CLIENT ID")}`;
  console.log(header);
  console.log();

  // Print rows (don't pad the last column)
  for (const provider of providers) {
    const name = provider.name.padEnd(nameWidth);
    const statusText = provider.enabled ? "enabled" : "disabled";
    const status = provider.enabled
      ? chalk.green(statusText.padEnd(statusWidth))
      : chalk.red(statusText.padEnd(statusWidth));
    const clientId = provider.clientId
      ? maskSecret(provider.clientId)
      : chalk.dim("—");

    console.log(`${name}  ${status}  ${clientId}`);
  }

  // Summary
  console.log();
  const enabledCount = providers.filter(p => p.enabled).length;
  const disabledCount = providers.length - enabledCount;
  console.log(
    chalk.dim(`${providers.length} provider(s) configured`) +
    ` (${chalk.green(enabledCount + " enabled")}, ${chalk.red(disabledCount + " disabled")})`
  );
  console.log();
}
