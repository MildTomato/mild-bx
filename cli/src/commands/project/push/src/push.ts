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
import { createClient, type Project } from "@/lib/api.js";
import { SUPABASE_DASHBOARD_URL } from "@/lib/env.js";
import { resolveProjectContext, resolveConfig, resolveEnvScope } from "@/lib/resolve-project.js";
import { listRemoteVariables, setRemoteVariable } from "@/lib/env-api-bridge.js";
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
import { printCommandHeader, printProjectContextLines, S_BAR } from "@/components/command-header.js";
import { C } from "@/lib/colors.js";
import { generated as fmtGenerated, verboseLog } from "@/lib/styles.js";
import { printWarning, createSpinner, printConfigDiffs, setOutputMode } from "@/components/output.js";
import { injectLocalEnvVars } from "@/lib/env-file.js";
import { checkEnvMatchesBranch, refreshTypesAndCodegen, runCodegenIfStale } from "@/lib/precheck.js";
import { providerPayloadToEnvVars } from "@/lib/auth-providers.js";
import { getEnvRefs, getSecretRefs, detectHardcodedSecrets, stripHardcodedSecrets, detectMissingSecrets, type HardcodedSecret } from "@/lib/config-ref.js";
import { commitAllConfigSnapshots } from "@/lib/config-storage-bridge.js";

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


async function buildPlan(options: {
  cwd: string;
  migrationsOnly: boolean;
  configOnly: boolean;
  config?: ProjectConfig;
  client?: ReturnType<typeof createClient>;
  projectRef?: string;
  verbose?: boolean;
  lookupEnvVar?: (key: string) => string | undefined;
}): Promise<PushPlan> {
  const { cwd, migrationsOnly, configOnly, config, client, projectRef, verbose, lookupEnvVar = (k) => process.env[k] } = options;
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

    const authPayload = buildAuthPayload(config, lookupEnvVar);
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

          const MAX_DIFF_RETRIES = 3;
          const DIFF_RETRY_DELAY_MS = 4000;
          let diffResult: Awaited<ReturnType<typeof diffSchemaWithPgDelta>> | undefined;
          let lastDiffError: Error | undefined;

          for (let attempt = 0; attempt < MAX_DIFF_RETRIES; attempt++) {
            try {
              diffResult = await diffSchemaWithPgDelta(connectionString, schemaDir);
              lastDiffError = undefined;
              break;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              const isTenantError = /tenant or user not found|tenant/i.test(msg);
              if (!isTenantError) {
                // Non-tenant error — propagate immediately
                throw new Error(`Schema diff failed: ${msg}`);
              }
              lastDiffError = err instanceof Error ? err : new Error(msg);
              log(`[pg-delta] Pooler not ready (attempt ${attempt + 1}/${MAX_DIFF_RETRIES}): ${msg}`);
              if (attempt < MAX_DIFF_RETRIES - 1) {
                await new Promise((r) => setTimeout(r, DIFF_RETRY_DELAY_MS));
              }
            }
          }

          if (lastDiffError) {
            // Exhausted retries on a tenant/pooler error — skip diff and warn
            warnings.push(
              "Schema diff skipped: pooler not ready yet (try again in a moment)"
            );
            log(`[pg-delta] Skipping schema diff after ${MAX_DIFF_RETRIES} failed attempts`);
          } else if (diffResult) {
            const statements = diffResult.statements ?? [];
            log(`[pg-delta] Found ${statements.length} changes`);
            plan.schema = {
              hasChanges: statements.length > 0,
              statements,
              connectionString,
            };
          }
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
  } catch (error) {
    // Migrations directory does not exist — that is fine, this project may use declarative schema only.
    // Re-throw unexpected errors (e.g. permissions) so they are not silently swallowed.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
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
  } catch (error) {
    // Functions directory does not exist — that is fine for projects without Edge Functions.
    // Re-throw unexpected errors (e.g. permissions) so they are not silently swallowed.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return plan;
}

async function getProjectWithRetry(
  client: ReturnType<typeof createClient>,
  projectRef: string,
  maxRetries = 3
): Promise<Project> {
  let lastError: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.getProject(projectRef);
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      // Retry on "not found" to handle propagation lag for newly-created branch refs
      if (!msg.includes("not found") && !msg.includes("404")) throw error;
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw lastError;
}

function emitHardcodedSecretsWarning(secrets: HardcodedSecret[], json: boolean): void {
  if (secrets.length === 0) return;
  const count = secrets.length;
  const fieldWord = count === 1 ? "field" : "fields";
  if (json) {
    console.error(JSON.stringify({
      status: "warning",
      type: "hardcoded_secrets",
      message: `${count} ${fieldWord} not pushed — remove from config and set via CLI`,
      fields: secrets.map(({ path, file, line, setCommand }) => ({ path, file, line, setCommand })),
    }));
    return;
  }
  const items = secrets
    .map(({ path, file, line, setCommand }) =>
      `  ${chalk.dim("•")}  ${path}  ${chalk.dim(`(${file}:${line})`)}\n     ${chalk.dim("→")}  ${chalk.yellow(setCommand)}`
    )
    .join("\n");
  p.log.warn(
    `${C.bgError} SECRET DETECTED ${C.reset}  ${count} ${fieldWord} not pushed — remove from config and set via CLI\n\n${items}`
  );
}

export async function pushCommand(options: PushOptions) {
  const dryRun = options.plan ?? false;
  const yes = options.yes ?? false;
  const migrationsOnly = options.migrationsOnly ?? false;
  const configOnly = options.configOnly ?? false;

  setVerbose(options.verbose ?? false);

  if (!options.json) {
    printCommandHeader({
      command: "supa project push",
      description: ["Push local changes to remote."],
    });
  }

  const { cwd, config, configLayers, branch: currentBranch, profile, projectRef, parentProjectRef, token, isBranch, branchCreated } =
    await resolveProjectContext(options);

  // Inject local env vars so implicit binding can resolve canonical names
  injectLocalEnvVars(cwd);

  // Build env var lookup: env-server is the source of truth, local process.env as fallback
  const scope = resolveEnvScope({ isBranch, config });
  let envServerVars: Record<string, string> = {};
  try {
    const vars = await listRemoteVariables(parentProjectRef, scope);
    envServerVars = Object.fromEntries(vars.map((v) => [v.key, v.value]));
  } catch (err) {
    if (options.verbose) {
      console.error(`[push] env-server fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const lookupEnvVar = (key: string): string | undefined => envServerVars[key] ?? process.env[key];

  // Warn if .env.local SUPABASE_URL doesn't match the resolved branch
  checkEnvMatchesBranch({ cwd, gitBranch: currentBranch, resolvedProjectRef: projectRef, config, json: options.json });

  const client = createClient(token);
  const projectConfig = config as ProjectConfig;

  // Detect and strip hardcoded secrets first — safeConfig is used for all subsequent checks and API calls
  const supabaseDir = join(cwd, "supabase");
  const hardcodedSecrets = !migrationsOnly ? detectHardcodedSecrets(supabaseDir, configLayers) : [];
  const safeConfig = hardcodedSecrets.length > 0 ? stripHardcodedSecrets(projectConfig) : projectConfig;

  // Secret warning is shown after the command header (see below)

  // Check for missing secrets on enabled features (blocks push — can't push half-configured providers)
  // Exclude paths already caught by detectHardcodedSecrets — those get stripped (not absent) and
  // will be flagged above. Double-flagging the same field is confusing and blocks push unnecessarily.
  if (!migrationsOnly) {
    const hardcodedPaths = new Set(hardcodedSecrets.map((s) => s.path));
    const missingSecrets = detectMissingSecrets(safeConfig, lookupEnvVar).filter((s) => !hardcodedPaths.has(s.path));
    if (missingSecrets.length > 0) {
      if (options.json) {
        console.log(JSON.stringify({
          status: "error",
          message: "Enabled features have unset secrets — push blocked",
          fields: missingSecrets,
        }));
      } else {
        console.error(chalk.bgYellow.black.bold(" MISSING SECRET ") + chalk.yellow(`  ${missingSecrets.length} field${missingSecrets.length === 1 ? "" : "s"} required by an enabled feature — push blocked\n`));
        for (const { path, envVarName } of missingSecrets) {
          console.error(`  ${chalk.dim("•")}  ${path}`);
          if (envVarName) console.error(`     ${chalk.dim("→")}  ${chalk.cyan(`supa project env set ${envVarName}=<value>`)}\n`);
        }
      }
      process.exit(1);
    }
  }

  // JSON mode
  if (options.json) {
    try {
      // Branch project refs don't work with GET /v1/projects/:ref — skip the health check
      if (!isBranch) {
        const project = await getProjectWithRetry(client, projectRef);

        if (project.status === "INACTIVE") {
          console.log(
            JSON.stringify({
              status: "error",
              message: "Project is paused",
              dashboardUrl: `${SUPABASE_DASHBOARD_URL}/project/${projectRef}`,
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
      }

      const plan = await buildPlan({
        cwd,
        migrationsOnly,
        configOnly,
        config: safeConfig,
        client,
        projectRef,
        verbose: options.verbose,
        lookupEnvVar,
      });

      // Scan for missing env/secret refs and append to plan warnings
      if (safeConfig) {
        const missingEnvWarnings: string[] = [];
        const envRefs = getEnvRefs(safeConfig);
        const secretRefs = getSecretRefs(safeConfig);
        for (const [varName] of envRefs) {
          if (!lookupEnvVar(varName)) missingEnvWarnings.push(varName);
        }
        for (const [varName] of secretRefs) {
          if (!lookupEnvVar(varName)) missingEnvWarnings.push(varName);
        }
        plan.warnings.push(...missingEnvWarnings.map((v) => `Missing env var: ${v}`));
      }

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
            warnings: plan.warnings,
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
        const postgrestPayload = buildPostgrestPayload(safeConfig);
        if (postgrestPayload && plan.config.postgrest.keys.length > 0) {
          await client.updatePostgrestConfig(projectRef, postgrestPayload);
        }

        const authPayload = buildAuthPayload(safeConfig, lookupEnvVar);
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

      emitHardcodedSecretsWarning(hardcodedSecrets, true);
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
  printProjectContextLines({
    parentRef: parentProjectRef,
    branchRef: isBranch ? projectRef : undefined,
    gitBranch: currentBranch || undefined,
    profileName: profile?.name,
    dashboardUrl: `${SUPABASE_DASHBOARD_URL}/project/${parentProjectRef}`,
    configLayers,
    extra: dryRun ? [["Mode", `${C.warning}plan (dry-run)${C.reset}`]] : undefined,
  });

  emitHardcodedSecretsWarning(hardcodedSecrets, false);

  const spinner = createSpinner();
  spinner.start("Connecting...");

  try {
    // Branch project refs don't work with GET /v1/projects/:ref — skip the health check.
    // For main project refs, retry up to 3 times on "not found" to handle propagation lag.
    if (!isBranch) {
      const project = await getProjectWithRetry(client, projectRef);

      if (project.status === "INACTIVE") {
        spinner.stop(chalk.red("Project is paused"));
        console.log(chalk.dim(`Restore from: ${SUPABASE_DASHBOARD_URL}/project/${projectRef}`));
        process.exit(1);
      }

      if (project.status !== "ACTIVE_HEALTHY" && project.status !== "ACTIVE_UNHEALTHY") {
        spinner.stop(chalk.red(`Project not ready (${project.status})`));
        process.exit(1);
      }
    }

    spinner.message("Building push plan...");

    const plan = await buildPlan({
      cwd,
      migrationsOnly,
      configOnly,
      config: safeConfig,
      client,
      projectRef,
      verbose: options.verbose,
      lookupEnvVar,
    });

    // Scan for missing env/secret refs and warn
    if (safeConfig) {
      const missingEnvVars: { varName: string; isSecret: boolean }[] = [];
      const envRefs = getEnvRefs(safeConfig);
      const secretRefs = getSecretRefs(safeConfig);
      for (const [varName] of envRefs) {
        if (!lookupEnvVar(varName)) missingEnvVars.push({ varName, isSecret: false });
      }
      for (const [varName] of secretRefs) {
        if (!lookupEnvVar(varName)) missingEnvVars.push({ varName, isSecret: true });
      }
      if (missingEnvVars.length > 0) {
        console.log(S_BAR);
        console.log(`${S_BAR}  ${chalk.yellow("⚠ Missing environment variables:")}`);
        for (const { varName, isSecret } of missingEnvVars) {
          const cmd = chalk.cyan(`supa env set ${varName}`);
          const note = isSecret ? chalk.dim("  (secret — run in terminal)") : "";
          console.log(`${S_BAR}    ${chalk.dim("•")} ${chalk.bold(varName.padEnd(30))} ${cmd}${note}`);
        }
        console.log(S_BAR);
      }
    }

    // Check for actual changes
    const hasConfigChanges =
      plan.config.postgrest.diffs.some((d) => d.changed) ||
      plan.config.auth.diffs.some((d) => d.changed);
    const hasSchemaChanges = plan.schema.hasChanges;
    const hasMigrations = plan.migrations.length > 0;

    const isEmpty =
      !hasMigrations && !hasConfigChanges && !hasSchemaChanges && plan.functions.length === 0;

    if (isEmpty) {
      // Still run codegen in case database.ts is newer than generated files
      runCodegenIfStale(cwd, projectConfig);
      spinner.stop(chalk.green("Nothing to push - everything is up to date"));
      process.exit(0);
    }

    spinner.stop("Push plan ready");

    // Show plan details inside the clack rail
    if (hasSchemaChanges && plan.schema.statements.length > 0) {
      console.log(S_BAR);
      console.log(`${S_BAR}  ${chalk.dim(`Schema changes (${plan.schema.statements.length}):`)}`);
      for (const stmt of plan.schema.statements.slice(0, 10)) {
        const display = stmt.length > 80 ? stmt.slice(0, 77) + "..." : stmt;
        console.log(`${S_BAR}    ${chalk.gray("-")} ${display}`);
      }
      if (plan.schema.statements.length > 10) {
        console.log(`${S_BAR}    ${chalk.dim(`... and ${plan.schema.statements.length - 10} more`)}`);
      }
    }

    if (hasMigrations) {
      console.log(S_BAR);
      console.log(`${S_BAR}  ${chalk.dim("Migrations:")}`);
      for (const m of plan.migrations) {
        console.log(`${S_BAR}    ${chalk.green("+")} ${m}`);
      }
    }

    printConfigDiffs(plan.config.postgrest.diffs, "API config changes");
    printConfigDiffs(plan.config.auth.diffs, "Auth config changes");

    if (plan.warnings.length > 0) {
      console.log(S_BAR);
      for (const w of plan.warnings) {
        printWarning(w)
      }
    }

    // Dry run - just show what would happen
    if (dryRun) {
      console.log(S_BAR);
      console.log(`${S_BAR}  ${chalk.yellow("(plan mode - no changes applied)")}`);
      return;
    }

    // Confirm unless --yes or non-TTY (can't prompt without a terminal)
    // If `push` had to create the preview branch during project resolution,
    // treat that as user intent to continue the push instead of prompting again.
    if (!yes && !branchCreated && process.stdin.isTTY) {
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
    let configChangesApplied = 0;
    let typesRefreshed = false;
    let codegenFiles: string[] = [];
    const applyWarnings: string[] = [];

    // Apply config changes
    if (hasConfigChanges) {
      const postgrestPayload = buildPostgrestPayload(safeConfig);
      if (postgrestPayload && plan.config.postgrest.keys.length > 0) {
        applySpinner.message("Updating API config...");
        await client.updatePostgrestConfig(projectRef, postgrestPayload);
        configChangesApplied += plan.config.postgrest.diffs.filter((d) => d.changed).length;
      }

      const authPayload = buildAuthPayload(safeConfig, lookupEnvVar);
      if (authPayload && plan.config.auth.keys.length > 0) {
        applySpinner.message("Updating Auth config...");
        await client.updateAuthConfig(projectRef, authPayload);
        configChangesApplied += plan.config.auth.diffs.filter((d) => d.changed).length;

        // Sync changed auth values back to env-server.
        // Only write keys that actually differ from remote (plan.config.auth.diffs tells us
        // which fields changed). Skipping unchanged/default values prevents cluttering
        // env-server with Supabase defaults that weren't explicitly set by the user.
        const changedKeys = new Set(plan.config.auth.diffs.filter((d) => d.changed).map((d) => d.key));
        if (changedKeys.size > 0) {
          const changedPayload = Object.fromEntries(
            Object.entries(authPayload as Record<string, unknown>).filter(([k]) => changedKeys.has(k))
          );
          const envVars = providerPayloadToEnvVars(changedPayload).map((v) => ({ ...v, scope }));
          setRemoteVariable(parentProjectRef, envVars).catch(() => {});
        }
      }

      // Snapshot all config layers so diffs are available at merge time.
      await commitAllConfigSnapshots(cwd, parentProjectRef, currentBranch ?? "main");
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

      // Refresh TypeScript types and run codegen
      applySpinner.message("Refreshing TypeScript types...");
      const typesResult = await refreshTypesAndCodegen({
        getTypes: () => client.getTypescriptTypes(projectRef, "public"),
        cwd,
        config: projectConfig,
        onLog: options.verbose ? (msg) => console.error(verboseLog(msg)) : undefined,
        onRetry: (n, delay, max) => applySpinner.message(`PostgREST schema cache not ready, retrying in ${delay / 1000}s… (${n}/${max})`),
      });
      if (typesResult.typesRefreshed) {
        typesRefreshed = true;
        codegenFiles = typesResult.generated;
      } else if (typesResult.error) {
        applyWarnings.push(`Types refresh failed: ${typesResult.error}`);
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

    const parts = [];
    if (appliedCount > 0) parts.push(`${appliedCount} migration${appliedCount !== 1 ? "s" : ""}`);
    if (configChangesApplied > 0) parts.push(`${configChangesApplied} config change${configChangesApplied !== 1 ? "s" : ""}`);
    const typesNote = typesRefreshed ? " (types refreshed)" : "";
    const summary = parts.length > 0 ? parts.join(", ") : "nothing";
    applySpinner.stop(chalk.green(`Pushed ${summary}${typesNote}`));

    for (const f of codegenFiles) console.log(chalk.dim(`  ${fmtGenerated(f)}`));
    for (const w of applyWarnings) printWarning(w);
  } catch (error) {
    spinner.stop("Push failed");
    p.log.error(error instanceof Error ? error.message : "Unknown error");
    process.exit(1);
  }
}
