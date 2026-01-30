import React, { useState, useEffect } from "react";
import { render, Text, Box, useApp } from "ink";
import SelectInput from "ink-select-input";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { Spinner, Status } from "../components/Spinner.js";
import { createClient } from "../lib/api.js";
import {
  getAccessToken,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
  Profile,
} from "../lib/config.js";
import { getCurrentBranch } from "../lib/git.js";
import {
  buildPostgrestPayload,
  buildAuthPayload,
  compareConfigs,
  type ProjectConfig,
  type ConfigDiff,
} from "../lib/sync.js";
import { ConfigDiffSummary } from "../components/ConfigDiff.js";
import { SchemaFileDisplay } from "../components/SqlHighlight.js";
import { applySchema, type SchemaFile, findSqlFiles } from "../lib/atlas.js";
import {
  diffSchemaWithPgDelta,
  applySchemaWithPgDelta,
  setVerbose,
} from "../lib/pg-delta.js";

interface ConfigPlanSection {
  keys: string[];
  diffs: ConfigDiff[];
}

interface SchemaPlan {
  hasChanges: boolean;
  files: SchemaFile[];
  statements: string[]; // Actual SQL statements from pg-delta diff
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

interface PushState {
  step: "loading" | "planning" | "confirm" | "applying" | "done" | "error";
  substep?: string; // Current operation being performed
  profile?: Profile;
  projectRef?: string;
  plan?: PushPlan;
  projectConfig?: ProjectConfig;
  appliedCount: number;
  typesRefreshed: boolean;
  error?: string;
  warnings: string[];
}

interface PushAppProps {
  cwd: string;
  profileName?: string;
  dryRun: boolean;
  yes: boolean;
  migrationsOnly: boolean;
  configOnly: boolean;
  verbose: boolean;
}

function PushApp({
  cwd,
  profileName,
  dryRun,
  yes,
  migrationsOnly,
  configOnly,
  verbose,
}: PushAppProps) {
  const { exit } = useApp();
  const [state, setState] = useState<PushState>({
    step: "loading",
    appliedCount: 0,
    typesRefreshed: false,
    warnings: [],
  });

  useEffect(() => {
    loadPlan();
  }, []);

  function exitWithError(error: string) {
    setState({
      step: "error",
      error,
      appliedCount: 0,
      typesRefreshed: false,
      warnings: [],
    });
    process.exitCode = 1;
    setTimeout(() => exit(), 100);
  }

  async function loadPlan() {
    // Load config
    const config = loadProjectConfig(cwd);
    if (!config) {
      exitWithError("No supabase/config.json found");
      return;
    }

    // Get current git branch
    const currentBranch = getCurrentBranch(cwd) || undefined;

    // Get profile
    const profile = getProfileOrAuto(config, profileName, currentBranch);
    if (!profile) {
      exitWithError("No profile configured");
      return;
    }

    // Get project ref
    const projectRef = getProjectRef(config, profile);
    if (!projectRef) {
      exitWithError("No project ref configured");
      return;
    }

    // Get access token
    const token = getAccessToken();
    if (!token) {
      exitWithError("Not logged in. Run: supa login");
      return;
    }

    // Build plan
    setState({
      step: "planning",
      profile,
      projectRef,
      appliedCount: 0,
      typesRefreshed: false,
      warnings: [],
    });

    const client = createClient(token);
    const projectConfig = config as ProjectConfig;

    // Check project status before proceeding
    try {
      const project = await client.getProject(projectRef);
      if (project.status === "INACTIVE") {
        exitWithError(
          `Project is paused. Restore from: https://supabase.com/dashboard/project/${projectRef}`,
        );
        return;
      }
      if (
        project.status !== "ACTIVE_HEALTHY" &&
        project.status !== "ACTIVE_UNHEALTHY"
      ) {
        exitWithError(
          `Project is not ready (status: ${project.status}). Wait for the project to become active.`,
        );
        return;
      }
    } catch (error) {
      exitWithError(
        `Failed to check project status: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    let plan: PushPlan;
    try {
      plan = await buildPlan({
        cwd,
        migrationsOnly,
        configOnly,
        config: projectConfig,
        client,
        projectRef,
        verbose,
      });
    } catch (error) {
      exitWithError(
        error instanceof Error ? error.message : "Failed to build plan",
      );
      return;
    }

    // Check for actual changes (not just keys, but diffs with changed: true)
    const postgrestChanges = plan.config.postgrest.diffs.filter(
      (d) => d.changed,
    );
    const authChanges = plan.config.auth.diffs.filter((d) => d.changed);
    const hasActualConfigChanges =
      postgrestChanges.length > 0 || authChanges.length > 0;
    const isEmpty =
      plan.migrations.length === 0 &&
      plan.functions.length === 0 &&
      !hasActualConfigChanges &&
      !plan.schema.hasChanges;

    if (isEmpty) {
      setState({
        step: "done",
        profile,
        projectRef,
        plan,
        projectConfig,
        appliedCount: 0,
        typesRefreshed: false,
        warnings: plan.warnings,
      });
      setTimeout(() => exit(), 100);
      return;
    }

    if (dryRun) {
      setState({
        step: "done",
        profile,
        projectRef,
        plan,
        projectConfig,
        appliedCount: 0,
        typesRefreshed: false,
        warnings: plan.warnings,
      });
      setTimeout(() => exit(), 100);
    } else if (yes) {
      // Set plan in state before applying
      setState({
        step: "applying",
        profile,
        projectRef,
        plan,
        projectConfig,
        appliedCount: 0,
        typesRefreshed: false,
        warnings: plan.warnings,
      });
      await applyPlan(token, projectRef, plan, projectConfig);
    } else {
      setState({
        step: "confirm",
        profile,
        projectRef,
        plan,
        projectConfig,
        appliedCount: 0,
        typesRefreshed: false,
        warnings: plan.warnings,
      });
    }
  }

  async function applyPlan(
    token: string,
    projectRef: string,
    plan: PushPlan,
    projectConfig?: ProjectConfig,
  ) {
    setState((s) => ({ ...s, step: "applying", substep: "Preparing..." }));

    const client = createClient(token);
    let appliedCount = 0;
    const applyWarnings: string[] = [];

    // Apply config changes first
    if (projectConfig) {
      const postgrestPayload = buildPostgrestPayload(projectConfig);
      if (postgrestPayload && plan.config.postgrest.keys.length > 0) {
        setState((s) => ({ ...s, substep: "Updating API config..." }));
        try {
          await client.updatePostgrestConfig(projectRef, postgrestPayload);
        } catch (error) {
          setState({
            step: "error",
            error: `Failed to update API config: ${error instanceof Error ? error.message : "Unknown error"}`,
            appliedCount,
            typesRefreshed: false,
            warnings: [],
          });
          process.exitCode = 1;
          setTimeout(() => exit(), 100);
          return;
        }
      }

      const authPayload = buildAuthPayload(projectConfig);
      if (authPayload && plan.config.auth.keys.length > 0) {
        setState((s) => ({ ...s, substep: "Updating Auth config..." }));
        try {
          await client.updateAuthConfig(projectRef, authPayload);
        } catch (error) {
          setState({
            step: "error",
            error: `Failed to update Auth config: ${error instanceof Error ? error.message : "Unknown error"}`,
            appliedCount,
            typesRefreshed: false,
            warnings: [],
          });
          process.exitCode = 1;
          setTimeout(() => exit(), 100);
          return;
        }
      }
    }

    // Apply schema changes via pg-delta (with PGlite as source) or fallback to direct SQL
    let schemaApplied = false;
    if (plan.schema.hasChanges && plan.schema.connectionString) {
      try {
        const schemaDir = join(cwd, "supabase", "schema");

        setState((s) => ({ ...s, substep: "Creating PGlite instance..." }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        setState((s) => ({
          ...s,
          substep: "Computing schema diff with pg-delta...",
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        const result = await applySchemaWithPgDelta(
          plan.schema.connectionString,
          schemaDir,
        );

        if (!result.success) {
          setState({
            step: "error",
            error: `Failed to apply schema:\n${result.output}`,
            appliedCount,
            typesRefreshed: false,
            warnings: [],
          });
          process.exitCode = 1;
          setTimeout(() => exit(), 100);
          return;
        }

        appliedCount += result.statements ?? plan.schema.statements.length;
        schemaApplied = true;
        setState((s) => ({
          ...s,
          substep: "Schema applied successfully",
          appliedCount,
        }));
        setState((s) => ({ ...s, appliedCount }));
      } catch (error) {
        setState({
          step: "error",
          error: `Failed to apply schema: ${error instanceof Error ? error.message : "Unknown error"}`,
          appliedCount,
          typesRefreshed: false,
          warnings: [],
        });
        process.exitCode = 1;
        setTimeout(() => exit(), 100);
        return;
      }
    }

    // Refresh TypeScript types after schema changes
    let typesRefreshed = false;
    if (schemaApplied) {
      setState((s) => ({ ...s, substep: "Refreshing TypeScript types..." }));
      try {
        const typesResp = await client.getTypescriptTypes(projectRef, "public");
        const typesPath = join(cwd, "supabase", "types", "database.ts");
        mkdirSync(dirname(typesPath), { recursive: true });
        writeFileSync(typesPath, typesResp.types);
        typesRefreshed = true;
      } catch (error) {
        applyWarnings.push(
          `Types refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Apply migrations (legacy)
    for (const migration of plan.migrations) {
      try {
        const migrationPath = join(cwd, "supabase", "migrations", migration);
        const content = readFileSync(migrationPath, "utf-8");

        // Extract name from filename
        const baseName = migration.replace(".sql", "");
        const parts = baseName.split("_");
        const name = parts.slice(1).join("_");

        await client.applyMigration(projectRef, content, name);
        appliedCount++;
        setState((s) => ({ ...s, appliedCount }));
      } catch (error) {
        setState({
          step: "error",
          error: `Failed to apply ${migration}: ${error instanceof Error ? error.message : "Unknown error"}`,
          appliedCount,
          typesRefreshed: false,
          warnings: [],
        });
        process.exitCode = 1;
        setTimeout(() => exit(), 100);
        return;
      }
    }

    setState((s) => ({
      ...s,
      step: "done",
      appliedCount,
      typesRefreshed,
      warnings: [...s.warnings, ...applyWarnings],
    }));
    setTimeout(() => exit(), 100);
  }

  async function handleConfirmChoice(choice: "apply" | "cancel") {
    if (choice === "apply") {
      const token = getAccessToken();
      if (token && state.projectRef && state.plan) {
        await applyPlan(
          token,
          state.projectRef,
          state.plan,
          state.projectConfig,
        );
      }
    } else {
      exit();
    }
  }

  if (state.step === "loading") {
    return (
      <Box padding={1}>
        <Spinner message="Loading configuration..." />
      </Box>
    );
  }

  if (state.step === "planning") {
    return (
      <Box padding={1}>
        <Spinner message="Building push plan..." />
      </Box>
    );
  }

  if (state.step === "error") {
    return (
      <Box padding={1}>
        <Status type="error" message={state.error || "Push failed"} />
      </Box>
    );
  }

  // Get changed diffs for display
  const postgrestDiffs = state.plan?.config.postgrest.diffs ?? [];
  const authDiffs = state.plan?.config.auth.diffs ?? [];
  const postgrestChanges = postgrestDiffs.filter((d) => d.changed);
  const authChanges = authDiffs.filter((d) => d.changed);
  const hasConfigChanges =
    postgrestChanges.length > 0 || authChanges.length > 0;
  const hasMigrations = (state.plan?.migrations.length ?? 0) > 0;
  const hasSchemaChanges = state.plan?.schema.hasChanges ?? false;

  // Shared plan details component
  const renderPlanDetails = () => (
    <>
      {/* Schema changes (pg-delta diff) */}
      {state.plan?.schema.hasChanges &&
        state.plan.schema.statements.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>
              Schema changes ({state.plan.schema.statements.length}):
            </Text>
            {state.plan.schema.statements.slice(0, 10).map((stmt, i) => (
              <Box key={i} marginLeft={1}>
                <Text color="gray">- </Text>
                <Text>
                  {stmt.length > 80 ? stmt.slice(0, 77) + "..." : stmt}
                </Text>
              </Box>
            ))}
            {state.plan.schema.statements.length > 10 && (
              <Box marginLeft={1}>
                <Text dimColor>
                  ... and {state.plan.schema.statements.length - 10} more
                </Text>
              </Box>
            )}
          </Box>
        )}

      {/* Legacy migrations */}
      {state.plan && state.plan.migrations.length > 0 && (
        <Box flexDirection="column" marginTop={hasSchemaChanges ? 1 : 0}>
          <Text dimColor>Migrations:</Text>
          {state.plan.migrations.map((m) => (
            <Text key={m}>
              {" "}
              <Text color="green">+</Text> <Text>{m}</Text>
            </Text>
          ))}
        </Box>
      )}

      <ConfigDiffSummary
        postgrestDiffs={postgrestDiffs}
        authDiffs={authDiffs}
        hasMigrations={hasMigrations || hasSchemaChanges}
      />
    </>
  );

  if (state.step === "confirm") {
    const confirmItems = [
      { key: "apply", label: "Apply changes", value: "apply" as const },
      { key: "cancel", label: "Cancel", value: "cancel" as const },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="yellow">
          Pending changes
        </Text>

        <Box marginTop={1} flexDirection="column">
          {renderPlanDetails()}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <SelectInput
            items={confirmItems}
            onSelect={(item) => handleConfirmChoice(item.value)}
          />
        </Box>
      </Box>
    );
  }

  if (state.step === "applying") {
    return (
      <Box padding={1}>
        <Spinner message={state.substep || "Applying changes..."} />
      </Box>
    );
  }

  // Build pending message
  const getPendingMessage = () => {
    const parts: string[] = [];
    if (hasSchemaChanges) parts.push("schema");
    if (hasMigrations) parts.push("migrations");
    if (hasConfigChanges) parts.push("config");
    return `Pending ${parts.join(" + ")} changes`;
  };

  const isEmpty =
    !state.plan ||
    (state.plan.migrations.length === 0 &&
      state.plan.functions.length === 0 &&
      !hasConfigChanges &&
      !hasSchemaChanges);

  return (
    <Box flexDirection="column" padding={1}>
      {isEmpty ? (
        <Status
          type="success"
          message="Nothing to push - everything is up to date"
        />
      ) : (
        <>
          <Status
            type={dryRun ? "info" : "success"}
            message={
              dryRun
                ? getPendingMessage()
                : `Pushed ${state.appliedCount} changes${state.typesRefreshed ? " (types refreshed)" : ""}`
            }
          />

          {dryRun && state.plan && (
            <Box marginTop={1} flexDirection="column">
              {renderPlanDetails()}

              <Box marginTop={1}>
                <Text dimColor>(plan mode - no changes applied)</Text>
              </Box>
            </Box>
          )}

          {state.warnings.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              {state.warnings.map((warning, i) => (
                <Text key={i} color="yellow">
                  Warning: {warning}
                </Text>
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

interface BuildPlanOptions {
  cwd: string;
  migrationsOnly: boolean;
  configOnly: boolean;
  config?: ProjectConfig;
  client?: ReturnType<typeof createClient>;
  projectRef?: string;
  verbose?: boolean;
}

async function buildPlan(options: BuildPlanOptions): Promise<PushPlan> {
  const {
    cwd,
    migrationsOnly,
    configOnly,
    config,
    client,
    projectRef,
    verbose,
  } = options;
  const log = (msg: string) => verbose && console.error(msg);
  const warnings: string[] = [];
  const plan: PushPlan = {
    migrations: [],
    functions: [],
    schema: { hasChanges: false, files: [], statements: [] },
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

      // Fetch remote config for diff
      if (client && projectRef) {
        const remoteConfig = await client.getPostgrestConfig(projectRef);
        plan.config.postgrest.diffs = compareConfigs(
          postgrestPayload as Record<string, unknown>,
          remoteConfig as Record<string, unknown>,
        );
      }
    }

    const authPayload = buildAuthPayload(config);
    if (authPayload) {
      plan.config.auth.keys = Object.keys(authPayload);

      // Fetch remote config for diff
      if (client && projectRef) {
        const remoteConfig = await client.getAuthConfig(projectRef);
        plan.config.auth.diffs = compareConfigs(
          authPayload as Record<string, unknown>,
          remoteConfig as Record<string, unknown>,
        );
      }
    }
  }

  if (configOnly) {
    return plan;
  }

  // Schema diff using pg-delta (if schema directory exists)
  const schemaDir = join(cwd, "supabase", "schema");
  if (existsSync(schemaDir) && client && projectRef) {
    const dbPassword = process.env.SUPABASE_DB_PASSWORD;
    if (dbPassword) {
      try {
        // Get pooler config for connection string
        const poolerConfig = await client.getPoolerConfig(projectRef);

        // Debug: log available pooler configs
        log(
          "[pooler] Available configs:",
          poolerConfig.map((p) => ({
            pool_mode: p.pool_mode,
            database_type: p.database_type,
            connection_string: p.connection_string
              ?.replace(/:[^@]+@/, ":***@")
              .slice(0, 80),
          })),
        );

        // Use session mode pooler (required for DDL/schema operations)
        const sessionPooler = poolerConfig.find(
          (p) => p.pool_mode === "session" && p.database_type === "PRIMARY",
        );
        const fallbackPooler = poolerConfig.find(
          (p) => p.database_type === "PRIMARY",
        );
        const pooler = sessionPooler || fallbackPooler;

        log(
          "[pooler] Selected:",
          sessionPooler ? "session" : "fallback (transaction)",
        );

        if (pooler?.connection_string) {
          // Replace placeholder password and force session pooler port (5432)
          const connectionString = pooler.connection_string
            .replace("[YOUR-PASSWORD]", dbPassword)
            .replace(":6543/", ":5432/");

          log("[pooler] Using session pooler (port 5432)");

          // Get local schema files for display
          const files = findSqlFiles(schemaDir);

          // Run pg-delta diff to get actual changes
          log("[pg-delta] Computing schema diff...");
          const diffResult = await diffSchemaWithPgDelta(
            connectionString,
            schemaDir,
          );

          const statements = diffResult.statements ?? [];
          log(`[pg-delta] Found ${statements.length} changes`);

          plan.schema = {
            hasChanges: statements.length > 0,
            files,
            statements,
            connectionString,
          };
        }
      } catch (error) {
        // Re-throw schema errors instead of swallowing them as warnings
        // These are real errors that should abort the push
        throw new Error(
          `Schema diff failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      warnings.push("Schema diff skipped: SUPABASE_DB_PASSWORD not set");
    }
  }

  // Find migrations (legacy - for projects not using declarative schema)
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
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "_shared"
      ) {
        plan.functions.push(entry.name);
      }
    }
    plan.functions.sort();
  } catch {
    // No functions directory
  }

  return plan;
}

interface PushOptions {
  profile?: string;
  plan?: boolean;
  yes?: boolean;
  migrationsOnly?: boolean;
  configOnly?: boolean;
  json?: boolean;
  verbose?: boolean;
}

export async function pushCommand(options: PushOptions) {
  const cwd = process.cwd();
  const dryRun = options.plan ?? false;
  const yes = options.yes ?? false;
  const migrationsOnly = options.migrationsOnly ?? false;
  const configOnly = options.configOnly ?? false;

  // Set verbose mode for pg-delta logging
  setVerbose(options.verbose ?? false);

  if (options.json) {
    // JSON mode
    const config = loadProjectConfig(cwd);
    if (!config) {
      console.log(
        JSON.stringify({ status: "error", message: "No config found" }),
      );
      process.exitCode = 1;
      return;
    }

    const currentBranch = getCurrentBranch(cwd) || undefined;
    const profile = getProfileOrAuto(config, options.profile, currentBranch);
    const projectRef = getProjectRef(config, profile);
    const token = getAccessToken();

    if (!token) {
      console.log(
        JSON.stringify({ status: "error", message: "Not logged in" }),
      );
      process.exitCode = 1;
      return;
    }

    if (!projectRef) {
      console.log(
        JSON.stringify({ status: "error", message: "No project ref" }),
      );
      process.exitCode = 1;
      return;
    }

    const client = createClient(token);
    const projectConfig = config as ProjectConfig;

    // Check project status before proceeding
    try {
      const project = await client.getProject(projectRef);
      if (project.status === "INACTIVE") {
        console.log(
          JSON.stringify({
            status: "error",
            message: "Project is paused",
            hint: "Restore the project from the Supabase dashboard",
            dashboardUrl: `https://supabase.com/dashboard/project/${projectRef}`,
          }),
        );
        process.exitCode = 1;
        return;
      }
      if (
        project.status !== "ACTIVE_HEALTHY" &&
        project.status !== "ACTIVE_UNHEALTHY"
      ) {
        console.log(
          JSON.stringify({
            status: "error",
            message: `Project is not ready (status: ${project.status})`,
            hint: "Wait for the project to become active",
          }),
        );
        process.exitCode = 1;
        return;
      }
    } catch (error) {
      console.log(
        JSON.stringify({
          status: "error",
          message: `Failed to check project status: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
      process.exitCode = 1;
      return;
    }

    let plan: PushPlan;
    try {
      plan = await buildPlan({
        cwd,
        migrationsOnly,
        configOnly,
        config: projectConfig,
        client,
        projectRef,
        verbose: options.verbose,
      });
    } catch (error) {
      console.log(
        JSON.stringify({
          status: "error",
          message:
            error instanceof Error ? error.message : "Failed to build plan",
        }),
      );
      process.exitCode = 1;
      return;
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
        }),
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
        }),
      );
      return;
    }

    let appliedCount = 0;

    // Apply config changes
    if (hasConfig) {
      const postgrestPayload = buildPostgrestPayload(projectConfig);
      if (postgrestPayload && plan.config.postgrest.keys.length > 0) {
        try {
          await client.updatePostgrestConfig(projectRef, postgrestPayload);
        } catch (error) {
          console.log(
            JSON.stringify({
              status: "error",
              message: "Failed to update API config",
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          );
          process.exitCode = 1;
          return;
        }
      }

      const authPayload = buildAuthPayload(projectConfig);
      if (authPayload && plan.config.auth.keys.length > 0) {
        try {
          await client.updateAuthConfig(projectRef, authPayload);
        } catch (error) {
          console.log(
            JSON.stringify({
              status: "error",
              message: "Failed to update Auth config",
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          );
          process.exitCode = 1;
          return;
        }
      }
    }

    // Apply schema changes via pg-delta (with PGlite as source)
    let schemaApplied = false;
    if (plan.schema.hasChanges && plan.schema.connectionString) {
      try {
        const schemaDir = join(cwd, "supabase", "schema");

        const result = await applySchemaWithPgDelta(
          plan.schema.connectionString,
          schemaDir,
        );

        if (!result.success) {
          console.log(
            JSON.stringify({
              status: "error",
              message: "Failed to apply schema",
              error: result.output,
            }),
          );
          process.exitCode = 1;
          return;
        }
        schemaApplied = true;
        appliedCount += result.statements ?? plan.schema.statements.length;
      } catch (error) {
        console.log(
          JSON.stringify({
            status: "error",
            message: "Failed to apply schema",
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        );
        process.exitCode = 1;
        return;
      }
    }

    // Apply migrations
    for (const migration of plan.migrations) {
      try {
        const migrationPath = join(cwd, "supabase", "migrations", migration);
        const content = readFileSync(migrationPath, "utf-8");
        const baseName = migration.replace(".sql", "");
        const parts = baseName.split("_");
        const name = parts.slice(1).join("_");

        await client.applyMigration(projectRef, content, name);
        appliedCount++;
      } catch (error) {
        console.log(
          JSON.stringify({
            status: "error",
            message: `Failed to apply ${migration}`,
            error: error instanceof Error ? error.message : "Unknown error",
            migrationsApplied: appliedCount,
          }),
        );
        process.exitCode = 1;
        return;
      }
    }

    console.log(
      JSON.stringify({
        status: "success",
        message: `Applied ${appliedCount} changes${hasConfig ? " + config" : ""}`,
        migrationsFound: plan.migrations.length,
        migrationsApplied: plan.migrations.length,
        schemaChangesApplied: plan.schema.statements.length,
        schemaApplied,
        configApplied: hasConfig,
      }),
    );
    return;
  }

  render(
    <PushApp
      cwd={cwd}
      profileName={options.profile}
      dryRun={dryRun}
      yes={yes}
      migrationsOnly={migrationsOnly}
      configOnly={configOnly}
      verbose={options.verbose ?? false}
    />,
  );
}
