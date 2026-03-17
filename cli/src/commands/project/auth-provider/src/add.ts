import * as p from "@clack/prompts";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { printHeader, S_BAR } from "@/components/command-header.js";
import { searchSelect, cancelSymbol } from "@/components/search-select.js";
import { writeJsonAtomic } from "@/lib/fs-atomic.js";
import { findSimilar } from "@/lib/string-similarity.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";
import {
  PROVIDER_DEFINITIONS,
  findProvider,
  buildProviderPayload,
  envVarName,
  getCallbackUrl,
  type ProviderDefinition,
} from "@/lib/auth-providers.js";
import type { ExternalProviderConfig } from "@/lib/config-types.js";
import { loadLocalEnvVars, writeEnvFile } from "@/lib/env-file.js";
import type { EnvVariable } from "@/lib/env-types.js";
import { createSpinner } from "@/components/output.js";

export interface AddOptions {
  "client-id"?: string;
  secret?: string;
  "secret-from-env"?: string;
  url?: string;
  "redirect-uri"?: string;
  "skip-nonce-check"?: boolean;
  "dry-run"?: boolean;
  json?: boolean;
  yes?: boolean;
  profile?: string;
}

export async function addAuthProvider(
  providerArg: string | undefined,
  options: AddOptions = {}
): Promise<void> {
  const isTTY = process.stdout.isTTY && !options.json;
  const isDryRun = options["dry-run"] || false;

  const ctx = await resolveProjectContext(options);
  const { projectRef, token: authToken, cwd } = ctx;

  // Fetch the project's database host so we can derive the correct project URL
  let dbHost = "";
  try {
    const projectClient = createClient(authToken);
    const projectData = await projectClient.getProject(projectRef);
    dbHost = projectData.database.host;
  } catch {
    // Non-fatal — callback URL display will be empty if project fetch fails
  }

  const spinner = createSpinner(options);

  if (isTTY) {
    printHeader(
      "supa project auth-provider add",
      "Configure an OAuth provider for your project.",
      ctx,
      isDryRun ? [["Mode", chalk.yellow("dry-run")]] : undefined
    );
  }

  // Select provider
  let provider: ProviderDefinition | undefined;
  if (providerArg) {
    provider = findProvider(providerArg);
    if (!provider) {
      // Suggest similar provider names
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
        p.log.message(`\n  Run ${chalk.cyan("supa project auth-provider add")} to see all available providers.`);
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
  } else if (isTTY) {
    // Interactive provider selection
    const categoryLabels: Record<string, string> = {
      popular: "Popular",
      social: "Social",
      enterprise: "Enterprise",
      other: "Other",
    };

    const items = PROVIDER_DEFINITIONS.map((p) => ({
      value: p.key,
      label: p.displayName,
      hint: categoryLabels[p.category] || p.category,
    }));

    const selected = await searchSelect({
      message: "Select auth provider",
      items,
    });

    if (selected === cancelSymbol) {
      p.cancel("Operation cancelled");
      process.exit(EXIT_CODES.USER_CANCELLED);
    }

    provider = findProvider(String(selected));
    if (!provider) {
      p.log.error("Provider selection failed. Please try again or specify a provider: supa project auth-provider add google");
      process.exit(EXIT_CODES.GENERIC_ERROR);
    }
  } else {
    const errorMsg = "Provider argument is required in non-interactive mode. Example: supa project auth-provider add google";
    if (options.json) {
      console.error(JSON.stringify({
        error: "MissingArgument",
        message: errorMsg,
        exitCode: EXIT_CODES.VALIDATION_ERROR,
      }, null, 2));
    } else {
      p.log.error(errorMsg);
    }
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  // Check if provider requires credentials
  if (!provider.requiresCredentials) {
    const warnMsg = `${provider.displayName} does not require OAuth credentials. Use "supa project auth-provider enable ${provider.key}" to enable it.`;
    if (options.json) {
      console.log(JSON.stringify({
        warning: warnMsg,
        provider: provider.key,
      }, null, 2));
    } else {
      p.log.warn(warnMsg);
    }
    return;
  }

  // Gather configuration
  const providerConfig: ExternalProviderConfig & { enabled: boolean } = {
    enabled: true,
  };

  // Client ID
  if (options["client-id"]) {
    providerConfig.client_id = options["client-id"];
  } else if (isTTY) {
    const clientId = await p.text({
      message: `${provider.displayName} Client ID`,
      placeholder: "Enter your OAuth client ID",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Client ID is required";
        }
      },
    });

    if (p.isCancel(clientId)) {
      p.cancel("Operation cancelled");
      process.exit(EXIT_CODES.USER_CANCELLED);
    }

    providerConfig.client_id = String(clientId);
  } else {
    const errorMsg = "--client-id is required in non-interactive mode";
    if (options.json) {
      console.error(JSON.stringify({
        error: "MissingFlag",
        message: errorMsg,
        exitCode: EXIT_CODES.VALIDATION_ERROR,
      }, null, 2));
    } else {
      p.log.error(errorMsg);
    }
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  // Validate client ID format
  if (!providerConfig.client_id?.match(/^[a-zA-Z0-9._-]+$/)) {
    const errorMsg = "Invalid client ID format. Client IDs should contain only letters, numbers, dots, underscores, and hyphens.";
    if (options.json) {
      console.error(JSON.stringify({
        error: "ValidationError",
        message: errorMsg,
        exitCode: EXIT_CODES.VALIDATION_ERROR,
      }, null, 2));
    } else {
      p.log.error(errorMsg);
    }
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  // Secret
  let secretValue: string;
  if (options.secret) {
    secretValue = options.secret;
  } else if (options["secret-from-env"]) {
    const envVar = options["secret-from-env"];
    secretValue = process.env[envVar] || "";
    if (!secretValue) {
      const errorMsg = `Environment variable ${envVar} is not set`;
      if (options.json) {
        console.error(JSON.stringify({
          error: "EnvVarNotSet",
          message: errorMsg,
          variable: envVar,
          exitCode: EXIT_CODES.VALIDATION_ERROR,
        }, null, 2));
      } else {
        p.log.error(errorMsg);
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
  } else if (isTTY) {
    const secret = await p.password({
      message: `${provider.displayName} Client Secret`,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Client Secret is required";
        }
      },
    });

    if (p.isCancel(secret)) {
      p.cancel("Operation cancelled");
      process.exit(EXIT_CODES.USER_CANCELLED);
    }

    secretValue = String(secret);
  } else {
    const errorMsg = "--secret or --secret-from-env is required in non-interactive mode";
    if (options.json) {
      console.error(JSON.stringify({
        error: "MissingFlag",
        message: errorMsg,
        exitCode: EXIT_CODES.VALIDATION_ERROR,
      }, null, 2));
    } else {
      p.log.error(errorMsg);
    }
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  // Warn about short secrets and ask for confirmation
  if (secretValue.length < 16 && isTTY) {
    p.log.warn("Client secret seems unusually short. Most OAuth secrets are 32+ characters.");

    const shouldContinue = await p.confirm({
      message: "Continue with this secret?",
      initialValue: false,
    });

    if (p.isCancel(shouldContinue) || !shouldContinue) {
      p.cancel("Operation cancelled");
      process.exit(EXIT_CODES.USER_CANCELLED);
    }
  }

  // URL (for providers that support it)
  if (provider.hasUrl) {
    if (options.url) {
      providerConfig.url = options.url;
    } else if (isTTY) {
      const url = await p.text({
        message: `${provider.displayName} URL`,
        placeholder: `Enter your ${provider.displayName} instance URL`,
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return "URL is required";
          }
          try {
            new URL(String(value));
          } catch {
            return "Invalid URL format";
          }
        },
      });

      if (p.isCancel(url)) {
        p.cancel("Operation cancelled");
        process.exit(EXIT_CODES.USER_CANCELLED);
      }

      providerConfig.url = String(url);
    }
  }

  // Redirect URI (optional, most users won't need this)
  if (options["redirect-uri"]) {
    providerConfig.redirect_uri = options["redirect-uri"];
  }

  // Skip nonce check (optional)
  if (options["skip-nonce-check"]) {
    providerConfig.skip_nonce_check = true;
  }

  // Build API payload with actual secret value
  const apiPayload = buildProviderPayload(provider, {
    ...providerConfig,
    secret: secretValue,
  });

  // Dry run: show what would happen
  if (isDryRun) {
    const dryRunOutput = {
      action: "add-provider",
      provider: {
        key: provider.key,
        displayName: provider.displayName,
      },
      changes: {
        remote: {
          enabled: true,
          client_id: providerConfig.client_id,
          hasSecret: true,
          ...(providerConfig.url && { url: providerConfig.url }),
          ...(providerConfig.redirect_uri && { redirect_uri: providerConfig.redirect_uri }),
          ...(providerConfig.skip_nonce_check && { skip_nonce_check: true }),
        },
        local: {
          configFile: "supabase/config.json",
          envFile: "supabase/.env",
          envVars: [
            `SUPABASE_AUTH_EXTERNAL_${provider.key.toUpperCase()}_CLIENT_ID`,
            envVarName(provider.key),
          ],
        },
      },
      callbackUrl: getCallbackUrl(dbHost, projectRef),
    };

    if (options.json) {
      console.log(JSON.stringify(dryRunOutput, null, 2));
    } else {
      p.log.message(
        `${S_BAR}\n` +
        `${S_BAR}  ${chalk.yellow("DRY RUN - No changes will be made")}\n` +
        `${S_BAR}\n` +
        `${S_BAR}  Would configure: ${chalk.cyan(provider.displayName)}\n` +
        `${S_BAR}\n` +
        `${S_BAR}  Remote changes:\n` +
        `${S_BAR}    • Enable provider\n` +
        `${S_BAR}    • Set client_id: ${providerConfig.client_id}\n` +
        `${S_BAR}    • Set client_secret: ••••••••\n` +
        (providerConfig.url ? `${S_BAR}    • Set URL: ${providerConfig.url}\n` : "") +
        `${S_BAR}\n` +
        `${S_BAR}  Local changes:\n` +
        `${S_BAR}    • Update: supabase/config.json (enabled: true)\n` +
        `${S_BAR}    • Write: supabase/.env (${`SUPABASE_AUTH_EXTERNAL_${provider.key.toUpperCase()}_CLIENT_ID`}, ${envVarName(provider.key)})\n` +
        `${S_BAR}\n` +
        `${S_BAR}  Callback URL:\n` +
        `${S_BAR}  ${chalk.cyan(getCallbackUrl(dbHost, projectRef))}\n` +
        `${S_BAR}\n` +
        `${S_BAR}  Run without --dry-run to apply these changes.\n` +
        `${S_BAR}`
      );
    }
    return;
  }

  // Push to remote
  spinner.start("Updating remote config...");

  try {
    const client = createClient(authToken);
    await client.updateAuthConfig(projectRef, apiPayload);

    spinner.stop("Remote config updated");
  } catch (error) {
    spinner.stop("Failed to update remote config");

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (options.json) {
      console.error(JSON.stringify({
        error: "NetworkError",
        message: "Failed to update remote config",
        details: errorMessage,
        provider: provider.key,
        exitCode: EXIT_CODES.NETWORK_ERROR,
      }, null, 2));
    } else {
      p.log.error(`Failed to update remote config: ${errorMessage}`);
      if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
        p.log.message("\nThis might be a network issue. Check your connection and try again.");
      }
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }

  // Update local config.json with implicit binding model
  // Only store enabled + non-sensitive optional fields
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

    // Implicit binding: only store enabled + optional non-sensitive fields
    // client_id and secret are resolved from canonical env vars
    const providerEntry: Record<string, unknown> = {
      enabled: true,
    };
    if (providerConfig.url) providerEntry.url = providerConfig.url;
    if (providerConfig.redirect_uri) providerEntry.redirect_uri = providerConfig.redirect_uri;
    if (providerConfig.skip_nonce_check) providerEntry.skip_nonce_check = true;

    configContent.auth.external[provider.key] = providerEntry;

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

  // Write canonical env vars to supabase/.env
  const clientIdEnvVar = `SUPABASE_AUTH_EXTERNAL_${provider.key.toUpperCase()}_CLIENT_ID`;
  const secretEnvVar = envVarName(provider.key);

  try {
    const existing = loadLocalEnvVars(cwd);
    const existingMap = new Map(existing.variables.map((v) => [v.key, v]));

    // Update or add client_id
    existingMap.set(clientIdEnvVar, {
      key: clientIdEnvVar,
      value: providerConfig.client_id!,
      secret: false,
    });

    // Update or add secret
    existingMap.set(secretEnvVar, {
      key: secretEnvVar,
      value: secretValue,
      secret: true,
    });

    const variables: EnvVariable[] = Array.from(existingMap.values());
    writeEnvFile(cwd, variables, existing.header);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(JSON.stringify({
        error: "FileWriteError",
        message: "Failed to update supabase/.env file",
        details: errorMessage,
        exitCode: EXIT_CODES.GENERIC_ERROR,
      }, null, 2));
    } else {
      p.log.error(`Failed to update supabase/.env: ${errorMessage}`);
    }
    process.exit(EXIT_CODES.GENERIC_ERROR);
  }

  // Success message
  if (isTTY) {
    // Close the rail
    console.log(S_BAR);
    console.log(`${chalk.dim("└")}`);
    console.log();

    const callbackUrl = getCallbackUrl(dbHost, projectRef);
    console.log(chalk.green("✓") + ` ${provider.displayName} configured successfully`);
    console.log();
    console.log(chalk.dim("  Changes made:"));
    console.log(`  ${chalk.dim("•")} Remote: Provider enabled with credentials`);
    console.log(`  ${chalk.dim("•")} Local: Config updated (supabase/config.json)`);
    console.log(`  ${chalk.dim("•")} Local: Env vars stored (supabase/.env)`);
    console.log();
    console.log(chalk.dim("  Next step:"));
    console.log(`  Add this callback URL to your ${provider.displayName} OAuth settings:`);
    console.log(`  ${chalk.cyan(callbackUrl)}`);
    console.log();
  } else if (options.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          provider: provider.key,
          displayName: provider.displayName,
          enabled: true,
          callbackUrl: getCallbackUrl(dbHost, projectRef),
          files: {
            config: "supabase/config.json",
            env: "supabase/.env",
          },
        },
        null,
        2
      )
    );
  }
}
