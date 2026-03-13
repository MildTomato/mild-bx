/**
 * Pull command - pull remote state to local
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createClient } from "@/lib/api.js";
import { SUPABASE_DASHBOARD_URL } from "@/lib/env.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import {
  buildPostgrestPayload,
  buildAuthPayload,
  compareConfigs,
  buildApiConfigFromRemote,
  buildAuthConfigFromRemote,
  type ConfigDiff,
  type ProjectConfig,
} from "@/lib/sync.js";
import { pullSchemaWithPgDelta, setVerbose } from "@/lib/pg-delta.js";
import { printCommandHeader, printProjectContextLines } from "@/components/command-header.js";
import { C } from "@/lib/colors.js";
import { generated as fmtGenerated, verboseLog } from "@/lib/styles.js";
import { checkEnvMatchesBranch, refreshTypesAndCodegen } from "@/lib/precheck.js";
import { createSpinner } from "@/components/output.js";

interface PullOptions {
  profile?: string;
  plan?: boolean;
  typesOnly?: boolean;
  schemas?: string;
  json?: boolean;
  verbose?: boolean;
  yes?: boolean;
}

function printConfigDiffs(diffs: ConfigDiff[], label: string) {
  const changes = diffs.filter((d) => d.changed);
  if (changes.length === 0) return;

  console.log(chalk.dim(`\n${label}:`));
  for (const diff of changes) {
    console.log(`  ${chalk.yellow(diff.key)}: ${chalk.red(String(diff.local))} → ${chalk.green(String(diff.remote))}`);
  }
}

export async function pullCommand(options: PullOptions) {
  const dryRun = options.plan ?? false;
  const typesOnly = options.typesOnly ?? false;
  const schemas = options.schemas ?? "public";

  setVerbose(options.verbose ?? false);

  const { cwd, config, branch: currentBranch, profile, projectRef, token } =
    await resolveProjectContext(options);
  const projectConfig = config as ProjectConfig;
  const mainProjectRef = projectConfig.project_id ?? projectRef;

  // Block pull when config is code-driven — config.json is the source of truth.
  if (config.config_source === "code") {
    if (options.json) {
      console.log(JSON.stringify({
        status: "error",
        code: "ConfigSourceIsCode",
        message: "Pull is not available when config_source is \"code\". Your config.json is the source of truth.",
      }));
    } else {
      console.error(chalk.red("Pull is not available when config_source is \"code\"."));
      console.error(chalk.dim("  Your supabase/config.json is the source of truth. Edit it directly to change settings."));
    }
    process.exit(1);
  }

  // Warn if .env.local SUPABASE_URL doesn't match the resolved branch
  checkEnvMatchesBranch({ cwd, gitBranch: currentBranch, resolvedProjectRef: projectRef, config, json: options.json });

  const client = createClient(token);

  if (!options.json) {
  }

  // JSON mode
  if (options.json) {
    try {
      const project = await client.getProject(projectRef);

      if (project.status === "INACTIVE") {
        console.log(JSON.stringify({
          status: "error",
          message: "Project is paused",
          dashboardUrl: `${SUPABASE_DASHBOARD_URL}/project/${projectRef}`,
        }));
        process.exit(1);
      }

      const result: Record<string, unknown> = {
        status: "success",
        profile: profile?.name,
        projectRef,
        dryRun,
      };

      if (typesOnly) {
        if (!dryRun) {
          const typesResult = await refreshTypesAndCodegen({
            getTypes: () => client.getTypescriptTypes(projectRef, schemas),
            cwd,
            config: projectConfig,
          });
          if (typesResult.typesRefreshed) result.typesWritten = true;
          if (typesResult.generated.length) result.codegenFiles = typesResult.generated;
          if (typesResult.error) throw new Error(typesResult.error);
        }
        result.message = "TypeScript types generated";
      } else {
        result.project = project;
        if (!dryRun) {
          const typesResult = await refreshTypesAndCodegen({
            getTypes: () => client.getTypescriptTypes(projectRef, schemas),
            cwd,
            config: projectConfig,
          });
          if (typesResult.typesRefreshed) result.typesWritten = true;
          if (typesResult.generated.length) result.codegenFiles = typesResult.generated;
        }
      }

      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : "Pull failed",
      }));
      process.exit(1);
    }
    return;
  }

  // Interactive mode
  printCommandHeader({
    command: "supa project pull",
    description: ["Pull remote state to local."],
  });
  const extra: [string, string][] = [];
  if (typesOnly) extra.push(["Mode", "types only"]);
  if (dryRun) extra.push(["Mode", `${C.warning}plan (dry-run)${C.reset}`]);
  printProjectContextLines({
    projectRef,
    mainProjectRef,
    gitBranch: currentBranch || undefined,
    profileName: profile?.name,
    extra: extra.length ? extra : undefined,
  });

  const spinner = createSpinner(options);
  spinner.start("Fetching remote state...");

  try {
    // Check project status
    const project = await client.getProject(projectRef);

    if (project.status === "INACTIVE") {
      spinner.stop(chalk.red("Project is paused"));
      console.log(chalk.dim(`Restore from: ${SUPABASE_DASHBOARD_URL}/project/${projectRef}`));
      process.exit(1);
    }

    if (project.status !== "ACTIVE_HEALTHY" && project.status !== "ACTIVE_UNHEALTHY") {
      spinner.stop(chalk.red(`Project not ready (${project.status})`));
      process.exit(1);
    }

    // Types only mode
    if (typesOnly) {
      if (dryRun) {
        spinner.stop("Types preview (dry run)");
        console.log(chalk.dim("\nWould write: supabase/types/database.ts"));
        return;
      }
      spinner.message("Generating TypeScript types...");
      const typesResult = await refreshTypesAndCodegen({
        getTypes: () => client.getTypescriptTypes(projectRef, schemas),
        cwd,
        config: projectConfig,
        onLog: options.verbose ? (msg) => console.error(verboseLog(msg)) : undefined,
        onRetry: (n, delay, max) => spinner.message(`PostgREST not ready, retrying in ${delay / 1000}s… (${n}/${max})`),
      });
      if (typesResult.typesRefreshed) {
        spinner.stop(chalk.green("Types updated"));
        console.log(chalk.dim("  Wrote supabase/types/database.ts"));
        for (const f of typesResult.generated) console.log(chalk.dim(`  ${fmtGenerated(f)}`));
      } else {
        spinner.stop(chalk.yellow("Types fetch failed"));
        if (typesResult.error) console.error(chalk.yellow(`  Warning: ${typesResult.error}`));
      }
      return;
    }

    // Fetch and compare configs
    const projectConfig = config as ProjectConfig;
    let postgrestDiffs: ConfigDiff[] = [];
    let authDiffs: ConfigDiff[] = [];

    try {
      const remotePostgrest = await client.getPostgrestConfig(projectRef);
      const localPostgrest = buildPostgrestPayload(projectConfig);
      if (localPostgrest) {
        postgrestDiffs = compareConfigs(
          localPostgrest as Record<string, unknown>,
          remotePostgrest as Record<string, unknown>
        );
      }
    } catch (error) {
      // Non-fatal: some projects may not expose postgrest config. Log for debugging.
      if (options.verbose) {
        console.error(`[pull] Skipping postgrest config diff: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      const remoteAuth = await client.getAuthConfig(projectRef);
      const localAuth = buildAuthPayload(projectConfig);
      if (localAuth) {
        authDiffs = compareConfigs(
          localAuth as Record<string, unknown>,
          remoteAuth as Record<string, unknown>
        );
      }
    } catch (error) {
      // Non-fatal: some projects may not expose auth config. Log for debugging.
      if (options.verbose) {
        console.error(`[pull] Skipping auth config diff: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const hasConfigChanges =
      postgrestDiffs.some((d) => d.changed) ||
      authDiffs.some((d) => d.changed);

    spinner.stop("Fetched remote state");

    // Show config diffs if any
    if (hasConfigChanges) {
      printConfigDiffs(postgrestDiffs, "API config changes");
      printConfigDiffs(authDiffs, "Auth config changes");
    }

    // Dry run - just show what would happen
    if (dryRun) {
      console.log(chalk.dim("\nWould write:"));
      if (hasConfigChanges) console.log(chalk.dim("  supabase/config.json"));
      console.log(chalk.dim("  supabase/types/database.ts"));
      console.log(chalk.dim("  supabase/schema/public/*.sql"));
      console.log(chalk.yellow("\n(dry run - no changes applied)"));
      return;
    }

    // Confirm if there are config changes (unless --yes or non-TTY)
    if (hasConfigChanges && !options.yes && process.stdin.isTTY) {
      const proceed = await p.confirm({
        message: "Pull these changes?",
      });

      if (p.isCancel(proceed) || !proceed) {
        p.cancel("Cancelled");
        process.exit(0);
      }
    }

    // Apply changes
    const applySpinner = createSpinner(options);
    applySpinner.start("Writing files...");

    let configUpdated = false;
    let typesUpdated = false;
    let schemaUpdated = false;

    // Update config
    if (hasConfigChanges) {
      const configPath = join(cwd, "supabase", "config.json");
      try {
        const existingConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        const remotePostgrest = await client.getPostgrestConfig(projectRef);
        const remoteAuth = await client.getAuthConfig(projectRef);

        const apiConfig = buildApiConfigFromRemote(remotePostgrest as Record<string, unknown>);
        const authConfig = buildAuthConfigFromRemote(remoteAuth as Record<string, unknown>);

        const updatedConfig = {
          ...existingConfig,
          api: { ...existingConfig.api, ...apiConfig },
          auth: { ...existingConfig.auth, ...authConfig },
        };

        writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2) + "\n");
        configUpdated = true;
      } catch (error) {
        // Non-fatal: config update failed (e.g. read/write error or API error).
        // Surface as a warning so the user knows it was skipped.
        console.error(chalk.yellow(`Warning: Could not update config.json: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    // Generate types and run codegen
    const typesResult = await refreshTypesAndCodegen({
      getTypes: () => client.getTypescriptTypes(projectRef, schemas),
      cwd,
      config: projectConfig,
      onLog: options.verbose ? (msg) => console.error(msg) : undefined,
      onRetry: (n, delay, max) => applySpinner.message(`PostgREST not ready, retrying in ${delay / 1000}s… (${n}/${max})`),
    });
    if (typesResult.typesRefreshed) {
      typesUpdated = true;
    } else if (typesResult.error) {
      console.error(chalk.yellow(`Warning: Could not generate TypeScript types: ${typesResult.error}`));
    }

    // Pull schema with pg-delta
    const dbPassword = process.env.SUPABASE_DB_PASSWORD;
    if (dbPassword) {
      try {
        const poolerConfig = await client.getPoolerConfig(projectRef);
        const sessionPooler = poolerConfig.find(
          (p: { pool_mode: string; database_type: string }) =>
            p.pool_mode === "session" && p.database_type === "PRIMARY"
        );
        const fallbackPooler = poolerConfig.find(
          (p: { database_type: string }) => p.database_type === "PRIMARY"
        );
        const pooler = sessionPooler || fallbackPooler;

        if (pooler?.connection_string) {
          const connectionString = pooler.connection_string
            .replace("[YOUR-PASSWORD]", dbPassword)
            .replace(":6543/", ":5432/");
          const schemaDir = join(cwd, "supabase", "schema");

          const result = await pullSchemaWithPgDelta(connectionString, schemaDir);
          if (result.success && result.files.length > 0) {
            for (const file of result.files) {
              mkdirSync(dirname(file.path), { recursive: true });
              writeFileSync(file.path, file.content);
            }
            schemaUpdated = true;
          }
        }
      } catch (error) {
        // Surface schema-pull failures so the user knows the schema was not updated.
        console.error(chalk.yellow(`Warning: Could not pull schema: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    const anythingUpdated = configUpdated || typesUpdated || schemaUpdated;
    applySpinner.stop(anythingUpdated ? chalk.green("Pull complete") : "Everything up to date");

    if (configUpdated) console.log(chalk.dim("  Updated supabase/config.json"));
    if (typesUpdated) console.log(chalk.dim("  Updated supabase/types/database.ts"));
    if (schemaUpdated) console.log(chalk.dim("  Updated supabase/schema/public/*.sql"));
    for (const f of typesResult.generated) console.log(chalk.dim(`  ${fmtGenerated(f)}`));

  } catch (error) {
    spinner.stop(chalk.red("Pull failed"));
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    process.exit(1);
  }
}
