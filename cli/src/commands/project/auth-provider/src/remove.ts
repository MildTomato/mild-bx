import * as p from "@clack/prompts";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { printCommandHeader, S_BAR } from "@/components/command-header.js";
import { findProvider, buildProviderPayload, PROVIDER_DEFINITIONS } from "@/lib/auth-providers.js";
import { writeJsonAtomic } from "@/lib/fs-atomic.js";
import { findSimilar } from "@/lib/string-similarity.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";

export interface RemoveOptions {
  yes?: boolean;
  "dry-run"?: boolean;
  json?: boolean;
  profile?: string;
}

export async function removeAuthProvider(
  providerArg: string,
  options: RemoveOptions = {}
): Promise<void> {
  const isTTY = process.stdout.isTTY && !options.json;
  const isDryRun = options["dry-run"] || false;
  const spinner = isTTY ? p.spinner() : null;

  if (isTTY) {
    printCommandHeader({
      command: "supa project auth-provider remove",
      description: ["Remove an OAuth provider and clear its credentials."],
    });
    console.log(S_BAR);
    if (isDryRun) {
      console.log(`${S_BAR}  ${chalk.yellow("Mode:")} ${chalk.yellow("dry-run")}`);
      console.log(S_BAR);
    }
  }

  const provider = findProvider(providerArg);
  if (!provider) {
    const suggestions = findSimilar(
      providerArg,
      PROVIDER_DEFINITIONS.map((p) => p.key),
      2,
      3
    );

    if (options.json) {
      console.error(JSON.stringify({
        error: "UnknownProvider",
        message: `Unknown provider: ${providerArg}`,
        suggestions,
        exitCode: EXIT_CODES.VALIDATION_ERROR,
      }));
    } else {
      p.log.error(`Unknown provider: ${providerArg}`);
      if (suggestions.length > 0) {
        p.log.message(`\n  Did you mean: ${suggestions.map((s) => chalk.cyan(s)).join(", ")}?`);
      }
    }
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  if (isDryRun) {
    const out = {
      action: "remove-provider",
      provider: { key: provider.key, displayName: provider.displayName },
      changes: {
        remote: { enabled: false, client_id: "", secret: "", url: "", redirect_uri: "" },
        local: { configFile: "supabase/config.json", removes: `auth.external.${provider.key}` },
      },
    };
    if (options.json) {
      console.log(JSON.stringify(out));
    } else {
      p.log.message(
        `${S_BAR}\n` +
        `${S_BAR}  ${chalk.yellow("DRY RUN - No changes will be made")}\n` +
        `${S_BAR}\n` +
        `${S_BAR}  Would remove: ${chalk.cyan(provider.displayName)}\n` +
        `${S_BAR}  Remote: disable + clear all credentials\n` +
        `${S_BAR}  Local: remove auth.external.${provider.key} from supabase/config.json\n` +
        `${S_BAR}`
      );
    }
    return;
  }

  // Confirm unless --yes
  if (!options.yes && isTTY) {
    const proceed = await p.confirm({
      message: `Remove ${chalk.cyan(provider.displayName)} and clear all credentials?`,
      initialValue: false,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled");
      return;
    }
  }

  const { projectRef, token: authToken, cwd } = await resolveProjectContext(options);
  const client = createClient(authToken);

  // Clear all credentials + disable
  spinner?.start(`Removing ${provider.displayName}...`);

  const payload = buildProviderPayload(provider, {
    enabled: false,
    client_id: "",
    secret: "",
    ...(provider.hasUrl ? { url: "" } : {}),
    redirect_uri: "",
  });

  try {
    await client.updateAuthConfig(projectRef, payload);
    spinner?.stop(`${provider.displayName} removed`);
  } catch (error) {
    spinner?.stop("Failed");
    const msg = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(JSON.stringify({ error: "NetworkError", message: msg, exitCode: EXIT_CODES.NETWORK_ERROR }));
    } else {
      p.log.error(`Failed to remove provider: ${msg}`);
    }
    process.exit(EXIT_CODES.NETWORK_ERROR);
  }

  // Remove from local config.json
  const configPath = path.join(cwd, "supabase", "config.json");
  try {
    const configContent = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (configContent.auth?.external?.[provider.key]) {
      delete configContent.auth.external[provider.key];
      writeJsonAtomic(configPath, configContent);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(JSON.stringify({ error: "FileWriteError", message: msg, exitCode: EXIT_CODES.GENERIC_ERROR }));
    } else {
      p.log.warn(`Remote updated but failed to update local config: ${msg}`);
    }
  }

  if (isTTY) {
    console.log(S_BAR);
    console.log(`${chalk.dim("└")}`);
    console.log();
    console.log(chalk.green("✓") + ` ${provider.displayName} removed successfully`);
    console.log();
    console.log(chalk.dim("  Changes made:"));
    console.log(`  ${chalk.dim("•")} Remote: Provider disabled, credentials cleared`);
    console.log(`  ${chalk.dim("•")} Local: Config updated (supabase/config.json)`);
    console.log();
  } else if (options.json) {
    console.log(JSON.stringify({
      success: true,
      provider: provider.key,
      displayName: provider.displayName,
    }));
  }
}
