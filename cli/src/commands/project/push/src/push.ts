/**
 * Push command - push local state to remote
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@/lib/api.js";
import {
  getAccessToken,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
} from "@/lib/config.js";
import { getCurrentBranch } from "@/lib/git.js";
import {
  buildPostgrestPayload,
  buildAuthPayload,
  compareConfigs,
  type ProjectConfig,
  type ConfigDiff,
} from "@/lib/sync.js";
import {
  diffSchemaWithPgDelta,
  applySchemaWithPgDelta,
  setVerbose,
} from "@/lib/pg-delta.js";
import { printCommandHeader, S_BAR } from "@/components/command-header.js";
import { C } from "@/lib/colors.js";
import { createSpinner } from "@/lib/spinner.js";

export interface PushOptions {
  profile?: string;
  plan?: boolean;
  yes?: boolean;
  migrationsOnly?: boolean;
  configOnly?: boolean;
  json?: boolean;
  verbose?: boolean;
}

interface ConfigPlanSection {
  keys: string[];
  diffs: ConfigDiff[];
}

interface SchemaPlan {
  hasChanges: boolean;
  statements: string[];
  connectionString?: string;
}

interface PushPlan {
  migrations: string[];
  functions: string[];
  schema: SchemaPlan;
  config: {
    postgrest: ConfigPlanSection;
    auth: ConfigPlanSection;
  };
  warnings: string[];
}

function printConfigDiffs(diffs: ConfigDiff[], label: string) {
  const changes = diffs.filter((d) => d.changed);
  if (changes.length === 0) return;

  console.log(chalk.dim(`\n${label}:`));
  for (const diff of changes) {
    console.log(
      `  ${chalk.yellow(diff.key)}: ${chalk.red(String(diff.local))} → ${chalk.green(String(diff.remote))}`
    );
  }
}

async function buildPlan(options: {
  cwd: string;
  migrationsOnly: boolean;
  configOnly: boolean;
  config?: ProjectConfig;
  client?: ReturnType<typeof createClient>;
  projectRef?: string;
  verbose?: boolean;
}): Promise<PushPlan> {
  const { cwd, migrationsOnly, configOnly, config, client, projectRef, verbose } = options;
  const log = (msg: string) => verbose && console.error(msg);
  const warnings: string[] = [];
  const plan: PushPlan = {
    migrations: [],
    functions: [],
    schema: { hasChanges: false, statements: [] },
    config: {
      postgrest: { keys: [], diffs: [] },
      auth: { keys: [], diffs: [] },
    },
    warnings,
  };

  // Config settings
  if (config && !migrationsOnly) {
    const postgrestPayload = buildPostgrestPayload(config);
    if (postgrestPayload) {
      plan.config.postgrest.keys = Object.keys(postgrestPayload);

      if (client && projectRef) {
        const remoteConfig = await client.getPostgrestConfig(projectRef);
        plan.config.postgrest.diffs = compareConfigs(
          postgrestPayload as Record<string, unknown>,
          remoteConfig as Record<string, unknown>
        );
      }
    }

    const authPayload = buildAuthPayload(config);
    if (authPayload) {
      plan.config.auth.keys = Object.keys(authPayload);

      if (client && projectRef) {
        const remoteConfig = await client.getAuthConfig(projectRef);
        plan.config.auth.diffs = compareConfigs(
          authPayload as Record<string, unknown>,
          remoteConfig as Record<string, unknown>
        );
      }
    }
  }

  if (configOnly) {
    return plan;
  }

  // Schema diff using pg-delta
  const schemaDir = join(cwd, "supabase", "schema");
  if (existsSync(schemaDir) && client && projectRef) {
    const dbPassword = process.env.SUPABASE_DB_PASSWORD;
    if (dbPassword) {
      try {
        const poolerConfig = await client.getPoolerConfig(projectRef);

        log(
          `[pooler] Available configs: ${JSON.stringify(
            poolerConfig.map((pc: { pool_mode: string; database_type: string; connection_string?: string }) => ({
              pool_mode: pc.pool_mode,
              database_type: pc.database_type,
              connection_string: pc.connection_string?.replace(/:[^@]+@/, ":***@").slice(0, 80),
            }))
          )}`
        );

        const sessionPooler = poolerConfig.find(
          (pc: { pool_mode: string; database_type: string }) =>
            pc.pool_mode === "session" && pc.database_type === "PRIMARY"
        );
        const fallbackPooler = poolerConfig.find(
          (pc: { database_type: string }) => pc.database_type === "PRIMARY"
        );
        const pooler = sessionPooler || fallbackPooler;

        log(`[pooler] Selected: ${sessionPooler ? "session" : "fallback (transaction)"}`);

        if (pooler?.connection_string) {
          const connectionString = pooler.connection_string
            .replace("[YOUR-PASSWORD]", dbPassword)
            .replace(":6543/", ":5432/");

          log("[pooler] Using session pooler (port 5432)");
          log("[pg-delta] Computing schema diff...");

          const diffResult = await diffSchemaWithPgDelta(connectionString, schemaDir);
          const statements = diffResult.statements ?? [];

          log(`[pg-delta] Found ${statements.length} changes`);

          plan.schema = {
            hasChanges: statements.length > 0,
            statements,
            connectionString,
          };
        }
      } catch (error) {
        throw new Error(
          `Schema diff failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else {
      warnings.push("Schema diff skipped: SUPABASE_DB_PASSWORD not set");
    }
  }

  // Find migrations (legacy)
  const migrationsDir = join(cwd, "supabase", "migrations");
  try {
    const entries = readdirSync(migrationsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && entry.name.endsWith(".sql")) {
        plan.migrations.push(entry.name);
      }
    }
    plan.migrations.sort();
  } catch {
    // No migrations directory
  }

  if (migrationsOnly) {
    return plan;
  }

  // Find functions
  const functionsDir = join(cwd, "supabase", "functions");
  try {
    const entries = readdirSync(functionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "_shared") {
        plan.functions.push(entry.name);
      }
    }
    plan.functions.sort();
  } catch {
    // No functions directory
  }

  return plan;
}

export async function pushCommand(options: PushOptions) {
  const cwd = process.cwd();
  const dryRun = options.plan ?? false;
  const yes = options.yes ?? false;
  const migrationsOnly = options.migrationsOnly ?? false;
  const configOnly = options.configOnly ?? false;

  setVerbose(options.verbose ?? false);

  // Load config
  const config = loadProjectConfig(cwd);
  if (!config) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "No config found" }));
    } else {
      console.error(chalk.red("No supabase/config.json found. Run `supa init` first."));
    }
    process.exit(1);
  }

  // Get profile and project ref
  const currentBranch = getCurrentBranch(cwd) || undefined;
  const profile = getProfileOrAuto(config, options.profile, currentBranch);
  const projectRef = getProjectRef(config, profile);
  const token = getAccessToken();

  if (!token) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "Not logged in" }));
    } else {
      console.error(chalk.red("Not logged in. Set SUPABASE_ACCESS_TOKEN."));
    }
    process.exit(1);
  }

  if (!projectRef) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "No project ref" }));
    } else {
      console.error(chalk.red("No project ref configured."));
    }
    process.exit(1);
  }

  const client = createClient(token);
  const projectConfig = config as ProjectConfig;

  // Non-TTY check for interactive mode
  if (!options.json && !process.stdin.isTTY) {
    console.error("Error: Interactive mode requires a TTY.");
    console.error("Use --json for non-interactive output.");
    process.exit(1);
  }

  // JSON mode
  if (options.json) {
    try {
      const project = await client.getProject(projectRef);

      if (project.status === "INACTIVE") {
        console.log(
          JSON.stringify({
            status: "error",
            message: "Project is paused",
            dashboardUrl: `https://supabase.com/dashboard/project/${projectRef}`,
          })
        );
        process.exit(1);
      }

      if (project.status !== "ACTIVE_HEALTHY" && project.status !== "ACTIVE_UNHEALTHY") {
        console.log(
          JSON.stringify({
            status: "error",
            message: `Project is not ready (status: ${project.status})`,
          })
        );
        process.exit(1);
      }

      const plan = await buildPlan({
        cwd,
        migrationsOnly,
        configOnly,
        config: projectConfig,
        client,
        projectRef,
        verbose: options.verbose,
      });

      const hasConfig =
        plan.config.postgrest.keys.length > 0 || plan.config.auth.keys.length > 0;
      const isEmpty =
        plan.migrations.length === 0 &&
        plan.functions.length === 0 &&
        !hasConfig &&
        !plan.schema.hasChanges;

      if (isEmpty) {
        console.log(
          JSON.stringify({
            status: "success",
            message: "Nothing to push",
            migrationsFound: 0,
            migrationsApplied: 0,
            configChanges: 0,
          })
        );
        return;
      }

      if (dryRun) {
        console.log(
          JSON.stringify({
            status: "success",
            message: "Dry run",
            dryRun: true,
            migrationsFound: plan.migrations.length,
            functionsFound: plan.functions.length,
            schemaChangesFound: plan.schema.statements.length,
            migrations: plan.migrations,
            functions: plan.functions,
            schema: {
              hasChanges: plan.schema.hasChanges,
              statements: plan.schema.statements,
            },
            config: plan.config,
            warnings: plan.warnings,
          })
        );
        return;
      }

      // Apply changes
      let appliedCount = 0;

      // Apply config
      if (hasConfig) {
        const postgrestPayload = buildPostgrestPayload(projectConfig);
        if (postgrestPayload && plan.config.postgrest.keys.length > 0) {
          await client.updatePostgrestConfig(projectRef, postgrestPayload);
        }

        const authPayload = buildAuthPayload(projectConfig);
        if (authPayload && plan.config.auth.keys.length > 0) {
          await client.updateAuthConfig(projectRef, authPayload);
        }
      }

      // Apply schema
      if (plan.schema.hasChanges && plan.schema.connectionString) {
        const schemaDir = join(cwd, "supabase", "schema");
        const result = await applySchemaWithPgDelta(plan.schema.connectionString, schemaDir);

        if (!result.success) {
          console.log(
            JSON.stringify({
              status: "error",
              message: "Failed to apply schema",
              error: result.output,
            })
          );
          process.exit(1);
        }
        appliedCount += result.statements ?? plan.schema.statements.length;
      }

      // Apply migrations
      for (const migration of plan.migrations) {
        const migrationPath = join(cwd, "supabase", "migrations", migration);
        const content = readFileSync(migrationPath, "utf-8");
        const baseName = migration.replace(".sql", "");
        const parts = baseName.split("_");
        const name = parts.slice(1).join("_");

        await client.applyMigration(projectRef, content, name);
        appliedCount++;
      }

      console.log(
        JSON.stringify({
          status: "success",
          message: `Applied ${appliedCount} changes${hasConfig ? " + config" : ""}`,
          migrationsFound: plan.migrations.length,
          migrationsApplied: plan.migrations.length,
          schemaChangesApplied: plan.schema.statements.length,
          configApplied: hasConfig,
        })
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          status: "error",
          message: error instanceof Error ? error.message : "Push failed",
        })
      );
      process.exit(1);
    }
    return;
  }

  // Interactive mode
  printCommandHeader({
    command: "supa project push",
    description: ["Push local changes to remote."],
  });
  console.log(S_BAR);
  console.log(`${S_BAR}  ${C.secondary}Project:${C.reset}  ${projectRef}`);
  console.log(`${S_BAR}  ${C.secondary}Profile:${C.reset}  ${profile?.name || "default"}`);
  if (currentBranch) {
    console.log(`${S_BAR}  ${C.secondary}Branch:${C.reset}   ${currentBranch}`);
  }
  if (dryRun) {
    console.log(`${S_BAR}  ${C.warning}Mode:${C.reset}     ${C.warning}plan (dry-run)${C.reset}`);
  }
  console.log(S_BAR);

  const spinner = createSpinner();
  spinner.start("Connecting...");

  try {
    // Check project status
    const project = await client.getProject(projectRef);

    if (project.status === "INACTIVE") {
      spinner.stop(chalk.red("Project is paused"));
      console.log(chalk.dim(`Restore from: https://supabase.com/dashboard/project/${projectRef}`));
      process.exit(1);
    }

    if (project.status !== "ACTIVE_HEALTHY" && project.status !== "ACTIVE_UNHEALTHY") {
      spinner.stop(chalk.red(`Project not ready (${project.status})`));
      process.exit(1);
    }

    spinner.message("Building push plan...");

    const plan = await buildPlan({
      cwd,
      migrationsOnly,
      configOnly,
      config: projectConfig,
      client,
      projectRef,
      verbose: options.verbose,
    });

    // Check for actual changes
    const postgrestChanges = plan.config.postgrest.diffs.filter((d) => d.changed);
    const authChanges = plan.config.auth.diffs.filter((d) => d.changed);
    const hasConfigChanges = postgrestChanges.length > 0 || authChanges.length > 0;
    const hasSchemaChanges = plan.schema.hasChanges;
    const hasMigrations = plan.migrations.length > 0;

    const isEmpty =
      !hasMigrations && !hasConfigChanges && !hasSchemaChanges && plan.functions.length === 0;

    if (isEmpty) {
      spinner.stop(chalk.green("Nothing to push - everything is up to date"));
      process.exit(0);
    }

    spinner.stop("Push plan ready");

    // Show plan details
    if (hasSchemaChanges && plan.schema.statements.length > 0) {
      console.log(chalk.dim(`\nSchema changes (${plan.schema.statements.length}):`));
      for (const stmt of plan.schema.statements.slice(0, 10)) {
        const display = stmt.length > 80 ? stmt.slice(0, 77) + "..." : stmt;
        console.log(`  ${chalk.gray("-")} ${display}`);
      }
      if (plan.schema.statements.length > 10) {
        console.log(chalk.dim(`  ... and ${plan.schema.statements.length - 10} more`));
      }
    }

    if (hasMigrations) {
      console.log(chalk.dim("\nMigrations:"));
      for (const m of plan.migrations) {
        console.log(`  ${chalk.green("+")} ${m}`);
      }
    }

    printConfigDiffs(plan.config.postgrest.diffs, "API config changes");
    printConfigDiffs(plan.config.auth.diffs, "Auth config changes");

    if (plan.warnings.length > 0) {
      console.log();
      for (const warning of plan.warnings) {
        console.log(chalk.yellow(`Warning: ${warning}`));
      }
    }

    // Dry run - just show what would happen
    if (dryRun) {
      console.log(chalk.yellow("\n(plan mode - no changes applied)"));
      return;
    }

    // Confirm unless --yes
    if (!yes) {
      const proceed = await p.confirm({
        message: "Push these changes?",
      });

      if (p.isCancel(proceed) || !proceed) {
        p.cancel("Cancelled");
        process.exit(0);
      }
    }

    // Apply changes
    const applySpinner = createSpinner();
    applySpinner.start("Applying changes...");

    let appliedCount = 0;
    let typesRefreshed = false;
    const applyWarnings: string[] = [];

    // Apply config changes
    if (hasConfigChanges) {
      const postgrestPayload = buildPostgrestPayload(projectConfig);
      if (postgrestPayload && plan.config.postgrest.keys.length > 0) {
        applySpinner.message("Updating API config...");
        await client.updatePostgrestConfig(projectRef, postgrestPayload);
      }

      const authPayload = buildAuthPayload(projectConfig);
      if (authPayload && plan.config.auth.keys.length > 0) {
        applySpinner.message("Updating Auth config...");
        await client.updateAuthConfig(projectRef, authPayload);
      }
    }

    // Apply schema changes
    if (hasSchemaChanges && plan.schema.connectionString) {
      applySpinner.message("Applying schema changes...");

      const schemaDir = join(cwd, "supabase", "schema");
      const result = await applySchemaWithPgDelta(plan.schema.connectionString, schemaDir);

      if (!result.success) {
        applySpinner.stop(chalk.red("Failed to apply schema"));
        console.error(chalk.red(result.output || "Unknown error"));
        process.exit(1);
      }

      appliedCount += result.statements ?? plan.schema.statements.length;

      // Refresh TypeScript types
      applySpinner.message("Refreshing TypeScript types...");
      try {
        const typesResp = await client.getTypescriptTypes(projectRef, "public");
        const typesPath = join(cwd, "supabase", "types", "database.ts");
        mkdirSync(dirname(typesPath), { recursive: true });
        writeFileSync(typesPath, typesResp.types);
        typesRefreshed = true;
      } catch (error) {
        applyWarnings.push(
          `Types refresh failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Apply migrations
    for (const migration of plan.migrations) {
      applySpinner.message(`Applying ${migration}...`);

      const migrationPath = join(cwd, "supabase", "migrations", migration);
      const content = readFileSync(migrationPath, "utf-8");
      const baseName = migration.replace(".sql", "");
      const parts = baseName.split("_");
      const name = parts.slice(1).join("_");

      await client.applyMigration(projectRef, content, name);
      appliedCount++;
    }

    const typesNote = typesRefreshed ? " (types refreshed)" : "";
    applySpinner.stop(chalk.green(`Pushed ${appliedCount} changes${typesNote}`));

    for (const warning of applyWarnings) {
      console.log(chalk.yellow(`Warning: ${warning}`));
    }
  } catch (error) {
    spinner.stop(chalk.red("Push failed"));
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    process.exit(1);
  }
}
