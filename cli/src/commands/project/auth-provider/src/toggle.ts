import * as p from "@clack/prompts";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { requireAuth, loadProjectConfig, getProfileOrAuto, getProjectRef } from "@/lib/config.js";
import { createClient } from "@/lib/api.js";
import { getCurrentBranch } from "@/lib/git.js";
import { printCommandHeader, S_BAR } from "@/components/command-header.js";
import { createSpinner } from "@/lib/spinner.js";
import { findProvider, buildProviderPayload, parseProviderFromRemote, PROVIDER_DEFINITIONS } from "@/lib/auth-providers.js";
import { writeJsonAtomic } from "@/lib/fs-atomic.js";
import { findSimilar } from "@/lib/string-similarity.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";

export interface ToggleOptions {
  "dry-run"?: boolean;
  json?: boolean;
  profile?: string;
}

export async function toggleAuthProvider(
  providerArg: string,
  enable: boolean,
  options: ToggleOptions = {}
): Promise<void> {
  const isTTY = process.stdout.isTTY && !options.json;
  const action = enable ? "enable" : "disable";
  const isDryRun = options["dry-run"] || false;
  const spinner = isTTY ? createSpinner() : null;

  if (isTTY) {
    printCommandHeader({
      command: `supa project auth-provider ${action}`,
      description: [`${enable ? "Enable" : "Disable"} an OAuth provider.`],
    });
    console.log(S_BAR);
    if (isDryRun) {
      console.log(`${S_BAR}  ${chalk.yellow("Mode:")} ${chalk.yellow("dry-run")}`);
      console.log(S_BAR);
    }
  }

  // Find provider (with typo suggestions)
  const provider = findProvider(providerArg);
  if (!provider) {
    const suggestions = findSimilar(
      providerArg,
      PROVIDER_DEFINITIONS.map(p => p.key),
      2,
      3
    );

    if (options.json) {
      console.error(JSON.stringify({
        error: "UnknownProvider",
        message: `Unknown provider: ${providerArg}`,
        suggestions,
        exitCode: EXIT_CODES.VALIDATION_ERROR,
      }, null, 2));
    } else {
      p.log.error(`Unknown provider: ${providerArg}`);
      if (suggestions.length > 0) {
        p.log.message(`\n  Did you mean: ${suggestions.map(s => chalk.cyan(s)).join(", ")}?`);
      }
      p.log.message(`\n  Run ${chalk.cyan("supa project auth-provider list")} to see all configured providers.`);
    }
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  // Authenticate
  spinner?.start("Authenticating...");
  const authToken = await requireAuth();
  spinner?.stop("Authenticated");

  // Load config and get project ref
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

  // Check current state
  spinner?.start("Checking current state...");
  const client = createClient(authToken);
  let currentState: boolean | null = null;

  try {
    const remoteConfig = await client.getAuthConfig(projectRef);
    const currentConfig = parseProviderFromRemote(provider, remoteConfig);
    currentState = currentConfig?.enabled ?? false;
    spinner?.stop("Current state checked");
  } catch (error) {
    spinner?.stop("Failed to check current state");
    // Continue anyway - we'll try to set it
  }

  // Check if already in desired state
  if (currentState === enable) {
    spinner?.stop();
    console.log(S_BAR);
    console.log(`${chalk.dim("└")}`);
    console.log();
    console.log(chalk.dim(`${provider.displayName} is already ${enable ? "enabled" : "disabled"}`));
    console.log();
    return;
  }

  // Build minimal payload
  const apiPayload = buildProviderPayload(provider, { enabled: enable });

  // Dry run: show what would happen
  if (isDryRun) {
    const dryRunOutput = {
      action: `${action}-provider`,
      provider: {
        key: provider.key,
        displayName: provider.displayName,
      },
      changes: {
        remote: { enabled: enable },
        local: { configFile: "supabase/config.json" },
      },
    };

    if (options.json) {
      console.log(JSON.stringify(dryRunOutput, null, 2));
    } else {
      p.log.message(
        `${S_BAR}\n` +
        `${S_BAR}  ${chalk.yellow("DRY RUN - No changes will be made")}\n` +
        `${S_BAR}\n` +
        `${S_BAR}  Would ${action}: ${chalk.cyan(provider.displayName)}\n` +
        `${S_BAR}\n` +
        `${S_BAR}  Remote changes:\n` +
        `${S_BAR}    • Set enabled: ${enable}\n` +
        `${S_BAR}\n` +
        `${S_BAR}  Local changes:\n` +
        `${S_BAR}    • Update: supabase/config.json\n` +
        `${S_BAR}\n` +
        `${S_BAR}  Run without --dry-run to apply these changes.\n` +
        `${S_BAR}`
      );
    }
    return;
  }

  // Push to remote
  spinner?.start(`${enable ? "Enabling" : "Disabling"} ${provider.displayName}...`);

  try {
    await client.updateAuthConfig(projectRef, apiPayload);

    spinner?.stop(`${provider.displayName} ${enable ? "enabled" : "disabled"}`);
  } catch (error) {
    spinner?.stop(`Failed to ${action} provider`);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (options.json) {
      console.error(JSON.stringify({
        error: "NetworkError",
        message: `Failed to ${action} provider`,
        details: errorMessage,
        provider: provider.key,
        exitCode: EXIT_CODES.NETWORK_ERROR,
      }, null, 2));
    } else {
      p.log.error(`Failed to ${action} provider: ${errorMessage}`);
      if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
        p.log.message("\nThis might be a network issue. Check your connection and try again.");
      }
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }

  // Update local config.json (atomic write)
  const supabaseDir = path.join(cwd, "supabase");
  const configPath = path.join(supabaseDir, "config.json");

  try {
    const configContent = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    if (!configContent.auth) {
      configContent.auth = {};
    }
    if (!configContent.auth.external) {
      configContent.auth.external = {};
    }
    if (!configContent.auth.external[provider.key]) {
      configContent.auth.external[provider.key] = {};
    }

    configContent.auth.external[provider.key].enabled = enable;

    // Atomic write to prevent corruption
    writeJsonAtomic(configPath, configContent);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(JSON.stringify({
        error: "FileWriteError",
        message: "Failed to update local config",
        details: errorMessage,
        file: configPath,
        exitCode: EXIT_CODES.GENERIC_ERROR,
      }, null, 2));
    } else {
      p.log.error(`Failed to update local config: ${errorMessage}`);
    }
    process.exit(EXIT_CODES.GENERIC_ERROR);
  }

  // Success message
  if (isTTY) {
    // Close the rail
    console.log(S_BAR);
    console.log(`${chalk.dim("└")}`);
    console.log();

    console.log(chalk.green("✓") + ` ${provider.displayName} ${enable ? "enabled" : "disabled"} successfully`);
    console.log();
    console.log(chalk.dim("  Changes made:"));
    console.log(`  ${chalk.dim("•")} Remote: Provider ${enable ? "enabled" : "disabled"}`);
    console.log(`  ${chalk.dim("•")} Local: Config updated (supabase/config.json)`);
    console.log();
  } else if (options.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          provider: provider.key,
          displayName: provider.displayName,
          enabled: enable,
          files: {
            config: "supabase/config.json",
          },
        },
        null,
        2
      )
    );
  }
}

export async function enableAuthProvider(
  providerArg: string,
  options: ToggleOptions = {}
): Promise<void> {
  return toggleAuthProvider(providerArg, true, options);
}

export async function disableAuthProvider(
  providerArg: string,
  options: ToggleOptions = {}
): Promise<void> {
  return toggleAuthProvider(providerArg, false, options);
}
