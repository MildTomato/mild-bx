import * as p from "@clack/prompts";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext, resolveEnvScope } from "@/lib/resolve-project.js";
import { printCommandHeader, printProjectContextLines, S_BAR } from "@/components/command-header.js";
import { searchSelect, cancelSymbol } from "@/components/search-select.js";
import { writeJsonAtomic } from "@/lib/fs-atomic.js";
import { findSimilar } from "@/lib/string-similarity.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";
import {
  PROVIDER_DEFINITIONS,
  findProvider,
  buildProviderPayload,
  providerPayloadToEnvVars,
  getCallbackUrl,
  envVarName,
  type ProviderDefinition,
} from "@/lib/auth-providers.js";
import type { ExternalProviderConfig } from "@/lib/config-types.js";
import { replaceRemoteVariables } from "@/lib/env-api-bridge.js";
import { createSpinner } from "@/components/output.js";
import { makeEnvRef, makeSecretRef, isConfigRef } from "@/lib/config-ref.js";

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
  const { projectRef, parentProjectRef, token: authToken, cwd } = ctx;

  // Fetch the project's database host so we can derive the correct project URL
  let dbHost = "";
  try {
    const projectClient = createClient(authToken);
    const projectData = await projectClient.getProject(parentProjectRef);
    dbHost = projectData.database.host;
  } catch {
    // Non-fatal — callback URL display will be empty if project fetch fails
  }

  const spinner = createSpinner(options);

  if (isTTY) {
    printCommandHeader({
      command: "supa project auth-provider add",
      description: ["Configure an OAuth provider for your project."],
    });
    printProjectContextLines({
      parentRef: parentProjectRef,
      branchRef: ctx.isBranch ? ctx.projectRef : undefined,
      gitBranch: ctx.branch,
      profileName: ctx.profile?.name,
      extra: [
        ["Scope", resolveEnvScope(ctx)],
        ...(isDryRun ? [["Mode", "dry-run"] as [string, string]] : []),
      ],
    });
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

  // Validate client ID format (skip validation for ref syntax)
  if (!isConfigRef(providerConfig.client_id) && !providerConfig.client_id?.match(/^[a-zA-Z0-9._-]+$/)) {
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

  // Secret — collect if available, otherwise continue without it.
  // In non-TTY mode we can't prompt, so we write everything else first
  // and then tell the user to set the secret separately.
  let secretValue: string | undefined;
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
  }
  // else: non-TTY with no secret — continue, write config + env vars, then prompt

  // Warn about short secrets and ask for confirmation (skip if no secret yet — user will set it later)
  if (secretValue !== undefined && secretValue.length < 16 && isTTY) {
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

  // Build API payload — secret may be undefined in non-TTY mode
  const apiPayload = buildProviderPayload(provider, {
    ...providerConfig,
    ...(secretValue !== undefined && { secret: secretValue }),
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
        },
        envServer: {
          projectRef: parentProjectRef,
          envVars: providerPayloadToEnvVars(apiPayload).map((v) => v.key),
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
        `${S_BAR}  Env server (${parentProjectRef}):\n` +
        `${S_BAR}    • Push: ${providerPayloadToEnvVars(apiPayload).map((v) => v.key).join(", ")}\n` +
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

  // Step 1: Update local config.json
  const supabaseDir = path.join(cwd, "supabase");
  const configPath = path.join(supabaseDir, "config.json");

  try {
    const configContent = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    if (!configContent.auth) configContent.auth = {};
    if (!configContent.auth.external) configContent.auth.external = {};

    // Write ref syntax so config.json can point to env vars without storing values.
    const clientIdVar = `SUPABASE_AUTH_EXTERNAL_${provider.key.toUpperCase()}_CLIENT_ID`;
    const secretVar = envVarName(provider.key);

    const providerEntry: Record<string, unknown> = {
      enabled: true,
      client_id: makeEnvRef(clientIdVar),
      secret: makeSecretRef(secretVar),
    };
    if (providerConfig.url) providerEntry.url = providerConfig.url;
    if (providerConfig.redirect_uri) providerEntry.redirect_uri = providerConfig.redirect_uri;
    if (providerConfig.skip_nonce_check) providerEntry.skip_nonce_check = true;

    configContent.auth.external[provider.key] = providerEntry;
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

  // Step 2: Push non-secret env vars to env-server.
  // Secret values (marked secret: true) are never stored in env-server —
  // they must be set by the user directly via `supa env set`.
  const envScope = resolveEnvScope(ctx);
  const allEnvVars = providerPayloadToEnvVars(apiPayload);
  const nonSecretEnvVars = allEnvVars
    .filter((v) => !v.secret)
    .map((v) => ({ ...v, scope: envScope }));

  try {
    if (nonSecretEnvVars.length > 0) {
      await replaceRemoteVariables(parentProjectRef, nonSecretEnvVars);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(JSON.stringify({
        error: "EnvServerError",
        message: "Failed to push env vars to env-server",
        details: errorMessage,
        exitCode: EXIT_CODES.GENERIC_ERROR,
      }, null, 2));
    } else {
      p.log.error(`Failed to push env vars to env-server: ${errorMessage}`);
    }
    process.exit(EXIT_CODES.GENERIC_ERROR);
  }

  // Step 3: Apply auth config via management API.
  // On a preview branch: demo hack — push to every preview branch so they all
  // reflect the env vars stored in env-server under the "preview" scope
  // (the platform doesn't resolve env vars per-branch yet).
  // On production: apply only to the parent project.
  spinner.start("Applying auth config…");
  try {
    const client = createClient(authToken);

    if (ctx.isBranch) {
      // Demo hack: the platform doesn't resolve env vars per-branch yet, so we
      // must push auth config to every preview branch manually.
      // We deliberately skip the default (production) branch — production is
      // only updated when auth-provider add is run directly on production.
      let allBranches: { project_ref: string; is_default: boolean }[] = [];
      try {
        allBranches = await client.listBranches(parentProjectRef);
      } catch {
        allBranches = [{ project_ref: projectRef, is_default: false }];
      }

      const previewRefs = allBranches
        .filter((b) => !b.is_default)
        .map((b) => b.project_ref);

      await Promise.allSettled(previewRefs.map((ref) => client.updateAuthConfig(ref, apiPayload)));
    } else {
      // Production — apply only to the parent
      await client.updateAuthConfig(parentProjectRef, apiPayload);
    }

    spinner.stop("Auth config applied");
  } catch (error) {
    spinner.stop("Failed to apply auth config");
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(JSON.stringify({
        error: "NetworkError",
        message: "Failed to apply auth config",
        details: errorMessage,
        provider: provider.key,
        exitCode: EXIT_CODES.NETWORK_ERROR,
      }, null, 2));
    } else {
      p.log.error(`Failed to apply auth config: ${errorMessage}`);
      if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
        p.log.message("\nThis might be a network issue. Check your connection and try again.");
      }
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }

  // Success message
  const secretVar = envVarName(provider.key);
  const callbackUrl = getCallbackUrl(dbHost, projectRef);

  if (isTTY) {
    // Close the rail
    console.log(S_BAR);
    console.log(`${chalk.dim("└")}`);
    console.log();

    console.log(chalk.green("✓") + ` ${provider.displayName} configured successfully`);
    console.log();
    console.log(chalk.dim("  Changes made:"));
    console.log(`  ${chalk.dim("•")} Remote: Provider enabled${secretValue ? " with credentials" : " (secret pending)"}`);
    console.log(`  ${chalk.dim("•")} Local: Config updated (supabase/config.json)`);
    console.log(`  ${chalk.dim("•")} Local: Env vars stored (supabase/.env)`);
    console.log();
    console.log(chalk.dim("  Next step:"));
    console.log(`  Add this callback URL to your ${provider.displayName} OAuth settings:`);
    console.log(`  ${chalk.cyan(callbackUrl)}`);
    console.log();
  } else if (options.json) {
    const output: Record<string, unknown> = {
      status: secretValue ? "success" : "action_required",
      provider: provider.key,
      displayName: provider.displayName,
      enabled: true,
      callbackUrl,
      files: {
        config: "supabase/config.json",
        env: "supabase/.env",
      },
    };
    if (!secretValue) {
      output.action = `Set the client secret: supa env set ${secretVar}`;
      output.variable = secretVar;
    }
    console.log(JSON.stringify(output, null, 2));
  }
}
