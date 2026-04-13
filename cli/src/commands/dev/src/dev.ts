/**
 * Dev command - watch for schema and config changes and sync to remote
 *
 * Similar to `supa push` but runs continuously, watching for changes
 * and automatically applying them.
 */

import { watch, writeFileSync, existsSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { createClient } from "@/lib/api.js";
import { SUPABASE_DASHBOARD_URL } from "@/lib/env.js";
import {
  requireAuth,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
  getProfileForBranch,
  getEnvironmentForBranch,
  AuthRequiredError,
  type Profile,
} from "@/lib/config.js";
import { loadEffectiveConfig, sanitizeBranchName } from "@/lib/config-overlay.js";
import { getCurrentBranch } from "@/lib/git.js";
import {
  diffSchemaWithPgDelta,
  applySchemaWithPgDelta,
  findSeedFiles,
  setVerbose,
  setLogCallback,
  closeSupabasePool,
} from "@/lib/pg-delta.js";
import { applyDevSeed } from "./seed.js";
import { getSeedConfig } from "@/lib/seed-config.js";
import { C } from "@/lib/colors.js";
import { isTTY } from "@clack/prompts";
import {
  buildPostgrestPayload,
  buildAuthPayload,
  compareConfigs,
  type ProjectConfig,
} from "@/lib/sync.js";
import { writeProjectEnv } from "@/lib/env-file.js";
import { isBranchingProfile } from "@/lib/workflow-profiles.js";
import { getWorkflowProfile } from "@/lib/config.js";
import { checkEnvMatchesBranch, runCodegenIfStale, refreshTypesAndCodegen } from "@/lib/precheck.js";
import { runHooks, runHooksAsync, getHookWatchSources } from "@/lib/hooks.js";
import { createFileWatcher, type WatchSource } from "@/lib/file-watcher.js";
import type { HooksConfig } from "@supabase-dx/config";
import { getEnvRefs, getSecretRefs, detectHardcodedSecrets, stripHardcodedSecrets, detectMissingSecrets } from "@/lib/config-ref.js";
import { listRemoteVariables } from "@/lib/env-api-bridge.js";
import { commitAllConfigSnapshots } from "@/lib/config-storage-bridge.js";
import { BranchResolutionError, resolveBranchContext, resolveEnvScope } from "@/lib/resolve-project.js";
import { reconcileConfigTargets } from "@/lib/config-reconciler.js";
import { createDevOutput } from "./dev-output.js";
import type { ConfigChange } from "./dev-output.js";

function watchGitBranch(cwd: string, onChange: () => void): () => void {
  const gitHeadPath = join(cwd, ".git", "HEAD");
  let watcher: ReturnType<typeof watch> | null = null;
  let fallbackInterval: ReturnType<typeof setInterval> | null = null;

  try {
    watcher = watch(gitHeadPath, () => onChange());
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
      fallbackInterval = setInterval(onChange, 5000);
    });
  } catch {
    fallbackInterval = setInterval(onChange, 5000);
  }

  return () => {
    watcher?.close();
    if (fallbackInterval) clearInterval(fallbackInterval);
  };
}

// Format config value for display
function formatConfigValue(value: unknown): string {
  if (value === undefined || value === null) return "unset";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function sanitizeConnectionString(connectionString: string): string {
  return connectionString.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/i, "$1***$2");
}

function isPasswordAuthError(message: string | undefined): boolean {
  return !!message && message.includes('password authentication failed for user "postgres"');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function applySchemaWithRetry(options: {
  connectionString: string;
  schemaDir: string;
  output: ReturnType<typeof createDevOutput>;
  lastPasswordRotationCompletedAt?: number;
}): Promise<Awaited<ReturnType<typeof applySchemaWithPgDelta>>> {
  const { connectionString, schemaDir, output, lastPasswordRotationCompletedAt } = options;

  try {
    return await applySchemaWithPgDelta(connectionString, schemaDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!lastPasswordRotationCompletedAt || !isPasswordAuthError(message)) {
      throw error;
    }

    const retryDelays = [3000, 5000, 8000];
    let lastError: unknown = error;

    for (const delayMs of retryDelays) {
      output.verboseLog(
        `db: auth failed ${Date.now() - lastPasswordRotationCompletedAt}ms after password rotation; retrying in ${delayMs}ms`,
      );
      await closeSupabasePool();
      await sleep(delayMs);

      try {
        return await applySchemaWithPgDelta(connectionString, schemaDir);
      } catch (retryError) {
        lastError = retryError;
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        if (!isPasswordAuthError(retryMessage)) {
          throw retryError;
        }
      }
    }

    throw lastError;
  }
}

/**
 * Scan config for env() and secret() refs and return any that are missing
 * from process.env.
 */
function getMissingEnvVars(
  config: ProjectConfig,
  lookupEnvVar: (key: string) => string | undefined = (k) => process.env[k],
): { name: string; isSecret: boolean }[] {
  const missing: { name: string; isSecret: boolean }[] = [];
  const envRefs = getEnvRefs(config);
  const secretRefs = getSecretRefs(config);
  for (const name of envRefs.keys()) {
    if (!lookupEnvVar(name)) missing.push({ name, isSecret: false });
  }
  for (const name of secretRefs.keys()) {
    if (!lookupEnvVar(name)) missing.push({ name, isSecret: true });
  }
  return missing;
}

interface DevOptions {
  profile?: string;
  debounce?: string;
  noBranchWatch?: boolean;
  typesInterval?: string;
  json?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  seed?: boolean;
  noSeed?: boolean;
}

interface DevState {
  profile?: Profile;
  projectRef?: string;
  isBranch: boolean;
  connectionString?: string;
  pendingSchemaChanges: Set<string>;
  pendingConfigChange: boolean;
  pendingSeedChange: boolean;
  lastPush: number;
  isApplying: boolean;
  seedApplied: boolean;
}

/**
 * Fetch the pooler connection string for a project ref, substituting the db password.
 * Returns undefined if the pooler config is unavailable.
 */
async function resolveConnectionString(
  client: ReturnType<typeof createClient>,
  projectRef: string,
  dbPassword: string,
): Promise<string | undefined> {
  const poolerConfig = await client.getPoolerConfig(projectRef);
  const pooler =
    poolerConfig.find((p) => p.pool_mode === "session" && p.database_type === "PRIMARY") ??
    poolerConfig.find((p) => p.database_type === "PRIMARY");
  if (!pooler?.connection_string) return undefined;
  return pooler.connection_string
    .replace("[YOUR-PASSWORD]", dbPassword)
    .replace(":6543/", ":5432/");
}

export async function devCommand(options: DevOptions): Promise<void> {
  const cwd = process.cwd();
  const schemaDir = join(cwd, "supabase", "schema");
  const typesPath = join(cwd, "supabase", "types", "database.ts");
  const isInteractive = isTTY(process.stdout) && !(options.verbose ?? false);

  setVerbose(options.verbose ?? false);

  // Parse debounce interval
  let debounceMs = 500;
  if (options.debounce) {
    const match = options.debounce.match(/^(\d+)(ms|s)?$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2] || "ms";
      debounceMs = value * (unit === "s" ? 1000 : 1);
    }
  }

  // Parse types interval
  let typesIntervalMs = 30000;
  if (options.typesInterval) {
    const match = options.typesInterval.match(/^(\d+)(s|m)?$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2] || "s";
      typesIntervalMs = value * (unit === "m" ? 60000 : 1000);
    }
  }

  // Create the output adapter early — all UI/events go through this
  const output = createDevOutput(options.json ?? false, options.verbose ?? false, isInteractive);

  // Two-step config load
  const _baseForEnv = loadProjectConfig(cwd);
  if (!_baseForEnv) {
    output.fatalError("No supabase/config.json found", `Run ${C.value}supa init${C.reset} to initialize`);
    process.exitCode = 1;
    return;
  }

  const _startupBranch = getCurrentBranch(cwd) || "unknown";
  const _startupEnv = getEnvironmentForBranch(_baseForEnv, _startupBranch);
  const { config: _initialConfig, layers: _initialLayers } = loadEffectiveConfig(cwd, _startupEnv, _startupBranch);
  let config = _initialConfig;
  let currentLayers = _initialLayers;

  const token = await requireAuth({ json: options.json });

  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) {
    output.fatalError(
      "SUPABASE_DB_PASSWORD environment variable is required",
      "Get your database password from the Supabase dashboard",
    );
    process.exitCode = 1;
    return;
  }

  if (!existsSync(schemaDir)) {
    output.fatalError(
      "No supabase/schema directory found",
      `Run ${C.value}supa schema pull${C.reset} to initialize`,
    );
    process.exitCode = 1;
    return;
  }

  let currentBranch = getCurrentBranch(cwd) || "unknown";
  let profile = getProfileOrAuto(config, options.profile, currentBranch);
  let projectRef = getProjectRef(config, profile);

  if (!projectRef) {
    output.fatalError("No project_id configured", `Add "project_id" to supabase/config.json`);
    process.exitCode = 1;
    return;
  }

  const client = createClient(token);
  output.verboseLog(`project: connecting to ${projectRef}`);

  const isProjectReady = (status: string) =>
    status === "ACTIVE_HEALTHY" || status === "ACTIVE_UNHEALTHY";

  const checkServicesHealth = async (): Promise<{ ready: boolean; status: string }> => {
    try {
      const health = await client.getProjectHealth(projectRef!, ["db", "pooler"]);
      const dbHealth = health.find((h) => h.name === "db");
      const poolerHealth = health.find((h) => h.name === "pooler");
      const dbReady = dbHealth?.status === "ACTIVE_HEALTHY";
      const poolerReady = poolerHealth?.status === "ACTIVE_HEALTHY";
      if (dbReady && poolerReady) return { ready: true, status: "healthy" };
      const statuses: string[] = [];
      if (dbHealth) statuses.push(`db: ${dbHealth.status}`);
      if (poolerHealth) statuses.push(`pooler: ${poolerHealth.status}`);
      return { ready: false, status: statuses.join(", ") || "checking" };
    } catch {
      return { ready: false, status: "checking" };
    }
  };

  // Check project status, waiting if transitional
  const waitForProject = async (): Promise<boolean> => {
    const maxWaitMs = 180000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();
    let lastStatus = "";
    let lastPhase = "project";
    let pollCount = 0;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const project = await client.getProject(projectRef!);
        const statusChanged = lastStatus !== "" && lastStatus !== project.status;
        lastStatus = project.status;
        pollCount++;

        if (project.status === "INACTIVE") {
          output.fatalError(
            "Project is paused",
            `Restore from: ${C.value}${SUPABASE_DASHBOARD_URL}/project/${projectRef}${C.reset}`,
          );
          return false;
        }

        if (isProjectReady(project.status)) {
          if (lastPhase === "project") {
            lastPhase = "services";
            output.projectActive();
          }

          const servicesHealth = await checkServicesHealth();
          if (servicesHealth.ready) return true;

          output.waitingForServices(servicesHealth.status, Date.now() - startTime, pollCount);
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          continue;
        }

        if (statusChanged || lastStatus === "") {
          output.waitingForProject(project.status, Date.now() - startTime, pollCount);
        } else {
          output.waitingForProject(project.status, Date.now() - startTime, pollCount);
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        if (error instanceof AuthRequiredError) throw error;
        output.fatalError(
          `Failed to check project status`,
          error instanceof Error ? error.message : String(error),
        );
        return false;
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    output.fatalError(
      `Timed out after ${elapsed}s waiting for project (last status: ${lastStatus})`,
      `Check: ${C.value}${SUPABASE_DASHBOARD_URL}/project/${projectRef}${C.reset}`,
    );
    return false;
  };

  output.header();

  // --- Connect to project ---
  output.connectingToProject();
  try {
    const project = await client.getProject(projectRef);
    output.connectedToProject();

    if (project.status === "INACTIVE") {
      output.fatalError(
        "Project is paused",
        `Restore from: ${C.value}${SUPABASE_DASHBOARD_URL}/project/${projectRef}${C.reset}`,
      );
      process.exitCode = 1;
      return;
    }

    if (!isProjectReady(project.status)) {
      output.waitingForProject(project.status, 0, 0);
      const ready = await waitForProject();
      if (!ready) {
        process.exitCode = 1;
        return;
      }
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      process.exitCode = 1;
      return;
    }
    output.connectFailed(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  // --- Resolve branch credentials ---
  const workflowProfile = getWorkflowProfile(config);
  let resolvedIsBranch = false;
  let _startupOverlayCreated = false;
  let lastPasswordRotationCompletedAt: number | undefined;

  if (isBranchingProfile(workflowProfile) && config.project_id) {
    const productionBranch = config.production_branch as string | undefined ?? "main";
    const isMainBranch = currentBranch === productionBranch || currentBranch === "master";

    output.resolvingBranch();
    try {
      const branchResult = await resolveBranchContext({
        cwd,
        gitBranch: currentBranch,
        parentProjectRef: config.project_id,
        token,
        client,
        pollForHealth: !isMainBranch,
        json: options.json,
        verbose: options.verbose,
        productionBranch,
      });

      if (!branchResult) {
        output.branchResolutionFailed();
        process.exitCode = 1;
        return;
      }

      projectRef = branchResult.projectRef;
      resolvedIsBranch = branchResult.isBranch;
      _startupOverlayCreated = branchResult.overlayCreated;
      lastPasswordRotationCompletedAt = Date.now();
      output.branchResolved();
      if (branchResult.overlayCreated) {
        output.overlayCreated("supabase/config.preview.json");
      }
    } catch (error) {
      output.branchResolutionFailed();
      if (error instanceof BranchResolutionError) {
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  } else if (config.project_id) {
    writeProjectEnv({ cwd, projectRef: config.project_id, token }).catch(() => {});
  }

  // Context lines printed after branch resolution so branchRef is known
  output.contextLines({
    parentRef: config.project_id ?? projectRef,
    branchRef: resolvedIsBranch ? projectRef : undefined,
    gitBranch: currentBranch,
    profileName: profile?.name,
    dashboardUrl: `${SUPABASE_DASHBOARD_URL}/project/${config.project_id ?? projectRef}`,
    configLayers: _initialLayers,
  });

  // --- Connection string ---
  let connectionString: string | undefined;
  try {
    connectionString = await resolveConnectionString(
      client,
      projectRef,
      process.env.SUPABASE_DB_PASSWORD ?? dbPassword,
    );
    output.verboseLog(`db: ${connectionString ? "resolved" : "missing"} connection string for ${projectRef}`);
    if (connectionString) output.verboseLog(`db: target ${sanitizeConnectionString(connectionString)}`);
  } catch (error) {
    output.fatalError(
      "Failed to get database connection",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
    return;
  }

  if (!connectionString) {
    output.fatalError("No database connection available");
    process.exitCode = 1;
    return;
  }

  const configPath = join(cwd, "supabase", "config.json");
  const supabaseDir = join(cwd, "supabase");

  const getOverlayPaths = (): string[] => {
    const env = getEnvironmentForBranch(config as Parameters<typeof getEnvironmentForBranch>[0], currentBranch);
    const paths: string[] = [];
    if (env && env !== "development") {
      paths.push(join(supabaseDir, `config.${env}.json`));
    }
    if (env === "preview") {
      paths.push(join(supabaseDir, `config.${sanitizeBranchName(currentBranch)}.json`));
    }
    return paths;
  };

  const seedConfig = getSeedConfig(config, options, supabaseDir);
  const seedEnabled = seedConfig.enabled;
  const seedPaths = seedConfig.paths;
  const seedDir = join(supabaseDir, "seeds");

  const state: DevState = {
    profile,
    projectRef,
    isBranch: resolvedIsBranch,
    connectionString,
    pendingSchemaChanges: new Set(),
    pendingConfigChange: false,
    pendingSeedChange: false,
    lastPush: 0,
    isApplying: false,
    seedApplied: false,
  };

  checkEnvMatchesBranch({ cwd, gitBranch: currentBranch, resolvedProjectRef: projectRef, config, json: options.json });

  const parentProjectRef = config.project_id ?? projectRef;

  const reconcileConfig = async () => {
    output.verboseLog("config: reconciling preview-wide targets…");
    const results = await reconcileConfigTargets({
      cwd,
      parentProjectRef,
      currentProjectRef: state.projectRef,
      currentBranch,
      isBranch: state.isBranch,
      client,
      dryRun: options.dryRun,
      verbose: options.verbose,
      includePreviewBranches: "auto",
    });
    const skipped = results.filter((r) => r.missing.length > 0);
    if (skipped.length > 0) {
      output.logNested(`${C.warning}⚠${C.reset} Config reconciliation skipped ${skipped.length} target${skipped.length === 1 ? "" : "s"} with missing env values`);
    }
  };

  // Extra context lines (schema, seed, hooks, mode)
  const extra: [string, string][] = [["Schema", relative(cwd, schemaDir)]];
  if (seedEnabled) {
    const seedDisplay = seedPaths.length === 1 ? seedPaths[0] : `${seedPaths.length} paths`;
    extra.push(["Seed", seedDisplay]);
  }
  const startupHooksConfig = (config as Record<string, unknown>).hooks as HooksConfig | undefined;
  if (startupHooksConfig?.pre_push) {
    const cmds = Array.isArray(startupHooksConfig.pre_push) ? startupHooksConfig.pre_push : [startupHooksConfig.pre_push];
    for (const cmd of cmds) {
      const label = typeof cmd === "string" ? cmd : cmd.command;
      extra.push(["Pre-push", label]);
    }
    const startupWatchSources = getHookWatchSources(startupHooksConfig.pre_push, cwd);
    if (startupWatchSources.length > 0) {
      extra.push(["  └ watch", startupWatchSources.map((s) => s.raw).join(", ")]);
    }
  }
  if (options.dryRun) extra.push(["Mode", `${C.warning}dry-run${C.reset}`]);
  output.contextExtra(extra);

  if (_startupOverlayCreated) output.overlayCreatedBanner();

  // Route pg-delta verbose logs through output
  if (options.verbose) setLogCallback((msg) => output.verboseLog(msg));

  // Run codegen at startup
  runCodegenIfStale(
    cwd,
    config,
    (f) => output.codegen(f),
    options.verbose ? (msg) => output.verboseLog(msg) : undefined,
  );

  // --- Branch watcher ---
  let lastBranch = currentBranch;
  let isResolvingBranch = false;
  let cleanupBranchWatch: (() => void) | undefined;

  if (!options.noBranchWatch) {
    cleanupBranchWatch = watchGitBranch(cwd, () => {
      const newBranch = getCurrentBranch(cwd);
      if (newBranch && newBranch !== lastBranch) {
        lastBranch = newBranch;
        const matched = getProfileForBranch(config, newBranch);

        if (matched && matched.name !== state.profile?.name) {
          state.profile = matched;
          state.projectRef = getProjectRef(config, matched);
        }
        output.branchChanged(newBranch, matched ?? undefined);

        const wfp = getWorkflowProfile(config);
        if (isBranchingProfile(wfp) && config.project_id) {
          if (!isResolvingBranch) {
            isResolvingBranch = true;
            output.verboseLog(`branch: resolving project ref for "${newBranch}"…`);
            resolveBranchContext({
              cwd,
              gitBranch: newBranch,
              parentProjectRef: config.project_id,
              token,
              client,
              pollForHealth: false,
              json: options.json,
              verbose: options.verbose,
              productionBranch: config.production_branch as string | undefined,
            }).catch((err) => {
              if (err instanceof BranchResolutionError) return null;
              throw err;
            }).then(async (result) => {
              if (result) {
                state.projectRef = result.projectRef;
                state.isBranch = result.isBranch;
                output.verboseLog(`branch: resolved → ${result.projectRef} (${result.isBranch ? "preview" : "main"})`);
                try {
                  output.verboseLog(`pooler: fetching connection string for ${result.projectRef}…`);
                  const cs = await resolveConnectionString(
                    client,
                    result.projectRef,
                    process.env.SUPABASE_DB_PASSWORD ?? dbPassword,
                  );
                  if (cs) {
                    state.connectionString = cs;
                    lastPasswordRotationCompletedAt = Date.now();
                    output.verboseLog(`db: target ${sanitizeConnectionString(cs)}`);
                    output.verboseLog(`pooler: connected`);
                  }
                } catch {
                  // Non-fatal — keep existing connection string
                }
                if (result.overlayCreated) output.overlayCreated("supabase/config.preview.json");
                output.envUpdated(newBranch, result.projectRef, result.isBranch);
              } else {
                output.verboseLog(`branch: no healthy branch found for "${newBranch}"`);
                output.envUpdateSkipped(newBranch, "no_healthy_branch");
              }
            }).catch((err) => {
              output.envUpdateError(newBranch, err instanceof Error ? err.message : String(err));
            }).finally(() => {
              isResolvingBranch = false;
            });
          }
        }
      }
    });
  }

  // --- syncConfig: compare local config vs remote, apply diffs ---
  const syncConfig = async (freshConfig: ProjectConfig): Promise<{
    changes: ConfigChange[];
    lookupEnvVar: (key: string) => string | undefined;
    strippedSecrets: ReturnType<typeof detectHardcodedSecrets>;
  }> => {
    const allChanges: ConfigChange[] = [];

    const strippedSecrets = detectHardcodedSecrets(join(cwd, "supabase"), currentLayers);
    const safeConfig = strippedSecrets.length > 0 ? stripHardcodedSecrets(freshConfig) : freshConfig;

    const scope = resolveEnvScope({ isBranch: state.isBranch, config: safeConfig });
    let envServerVars: Record<string, string> = {};
    try {
      const vars = await listRemoteVariables(parentProjectRef, scope);
      envServerVars = Object.fromEntries(vars.map((v) => [v.key, v.value]));
    } catch {
      // env-server not running — fall back to process.env only
    }
    const lookupEnvVar = (key: string): string | undefined => envServerVars[key] ?? process.env[key];

    const postgrestPayload = buildPostgrestPayload(safeConfig);
    if (postgrestPayload && Object.keys(postgrestPayload).length > 0) {
      output.verboseLog(`GET /v1/projects/${state.projectRef}/config/postgrest`);
      const remoteConfig = await client.getPostgrestConfig(state.projectRef!);
      const diffs = compareConfigs(
        postgrestPayload as Record<string, unknown>,
        remoteConfig as Record<string, unknown>,
      );
      const changedDiffs = diffs.filter((d) => d.changed);
      output.verboseLog(`config: postgrest — ${changedDiffs.length} change(s)`);
      for (const diff of changedDiffs) {
        allChanges.push({
          key: `api.${diff.key}`,
          oldValue: formatConfigValue(diff.oldValue),
          newValue: formatConfigValue(diff.newValue),
        });
      }
      if (!options.dryRun && changedDiffs.length > 0) {
        output.verboseLog(`PATCH /v1/projects/${state.projectRef}/config/postgrest`);
        await client.updatePostgrestConfig(state.projectRef!, postgrestPayload);
      }
    }

    const authPayload = buildAuthPayload(safeConfig, lookupEnvVar);
    if (authPayload && Object.keys(authPayload).length > 0) {
      output.verboseLog(`GET /v1/projects/${state.projectRef}/config/auth`);
      const remoteConfig = await client.getAuthConfig(state.projectRef!);
      const diffs = compareConfigs(
        authPayload as Record<string, unknown>,
        remoteConfig as Record<string, unknown>,
      );
      const changedDiffs = diffs.filter((d) => d.changed);
      output.verboseLog(`config: auth — ${changedDiffs.length} change(s)`);
      for (const diff of changedDiffs) {
        allChanges.push({
          key: `auth.${diff.key}`,
          oldValue: formatConfigValue(diff.oldValue),
          newValue: formatConfigValue(diff.newValue),
        });
      }
      if (!options.dryRun && changedDiffs.length > 0) {
        output.verboseLog(`PATCH /v1/projects/${state.projectRef}/config/auth`);
        await client.updateAuthConfig(state.projectRef!, authPayload);
      }
    }

    return { changes: allChanges, lookupEnvVar, strippedSecrets };
  };

  // --- applyConfigChanges ---
  const applyConfigChanges = async (): Promise<((key: string) => string | undefined) | undefined> => {
    output.configSyncStart();
    try {
      const { config: freshConfig, layers: freshLayers } = loadEffectiveConfig(cwd, undefined, currentBranch);
      if (!freshConfig) {
        output.configSyncError("could not reload config.json");
        return undefined;
      }
      currentLayers = freshLayers;
      const { changes, lookupEnvVar, strippedSecrets } = await syncConfig(freshConfig as ProjectConfig);
      if (strippedSecrets.length > 0) output.hardcodedSecrets(strippedSecrets);
      const generated = runCodegenIfStale(cwd, freshConfig as ProjectConfig) ?? [];
      if (changes.length === 0) {
        output.configSyncNoChanges();
      } else {
        output.configSyncComplete({ dryRun: options.dryRun ?? false, applied: changes.length, generated });
        output.logConfigChanges(changes);
      }
      if (!options.dryRun) {
        await commitAllConfigSnapshots(cwd, parentProjectRef, currentBranch ?? "main");
        await reconcileConfig();
      }
      return lookupEnvVar;
    } catch (error) {
      output.configSyncError(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  };

  // --- applySchemaChanges ---
  const applySchemaChanges = async (changedFiles: string[]) => {
    output.syncStart(changedFiles);
    try {
      if (options.dryRun) {
        output.verboseLog(`pg-delta: computing diff…`);
        const diff = await diffSchemaWithPgDelta(state.connectionString!, schemaDir);
        output.verboseLog(`pg-delta: ${diff.hasChanges ? `${diff.statements.length} statement(s)` : "no changes"}`);
        output.syncPlan(diff.hasChanges, diff.statements);
      } else {
        output.verboseLog(`pg-delta: applying schema…`);
        const result = await applySchemaWithPgDelta(state.connectionString!, schemaDir);
        output.verboseLog(`pg-delta: ${result.success ? `${result.statements ?? 0} statement(s) applied` : `failed — ${result.output?.slice(0, 80)}`}`);

        if (result.success && result.output !== "No changes to apply") {
          const generated: string[] = [];
          const typesResult = await refreshTypesAndCodegen({
            getTypes: () => client.getTypescriptTypes(state.projectRef!, "public"),
            cwd,
            config,
            onGenerated: (f) => generated.push(f),
            onLog: options.verbose ? (msg) => output.verboseLog(msg) : undefined,
            onRetry: (n, delay, max) => output.typesRetry(n, delay, max),
          });
          if (typesResult.typesRefreshed) {
            output.typesUpdated(relative(cwd, typesPath), generated);
            lastTypesRefreshTime = Date.now();
          }
          if (typesResult.error) output.typesError(typesResult.error);

          // Log changed files
          for (const f of changedFiles.slice(0, 5)) output.logNested(f);
          if (changedFiles.length > 5) output.logNested(`+${changedFiles.length - 5} more files`);
        }

        output.syncComplete(result);
      }
    } catch (error) {
      output.syncComplete({ success: false, output: error instanceof Error ? error.message : String(error) });
    }
  };

  // --- applySeed ---
  const applySeed = async (_reason: "initial" | "change" = "change") => {
    if (!seedEnabled || options.dryRun) return;
    try {
      const result = await applyDevSeed(state.connectionString!, seedPaths, supabaseDir);
      if (result.skipped) return;
      if (!state.seedApplied) {
        output.seedStart(result.totalFiles);
      }
      output.seedComplete(result);
      state.seedApplied = true;
    } catch (error) {
      output.seedError(error instanceof Error ? error.message : String(error));
    }
  };

  // --- applyPendingChanges (debounced) ---
  let debounceTimer: NodeJS.Timeout | null = null;
  let isRunningHooks = false;

  const scheduleDebounce = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => applyPendingChanges(), debounceMs);
  };

  const applyPendingChanges = async () => {
    if (state.isApplying || isRunningHooks) return;
    if (state.pendingSchemaChanges.size === 0 && !state.pendingConfigChange && !state.pendingSeedChange) return;

    if (isResolvingBranch) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => applyPendingChanges(), 500);
      return;
    }

    state.isApplying = true;
    const schemaChanges = [...state.pendingSchemaChanges];
    const configChanged = state.pendingConfigChange;
    const seedChanged = state.pendingSeedChange;
    state.pendingSchemaChanges.clear();
    state.pendingConfigChange = false;
    state.pendingSeedChange = false;

    let lookupEnvVar: ((key: string) => string | undefined) | undefined;
    if (configChanged) {
      lookupEnvVar = await applyConfigChanges();
      const freshConfig = loadEffectiveConfig(cwd, undefined, currentBranch).config;
      if (freshConfig) {
        config = freshConfig;
        runCodegenIfStale(
          cwd,
          config as ProjectConfig,
          (f) => output.codegen(f),
          options.verbose ? (msg) => output.verboseLog(msg) : undefined,
        );
      }
    }

    if (schemaChanges.length > 0) await applySchemaChanges(schemaChanges);

    if (seedChanged || (schemaChanges.length > 0 && options.seed)) await applySeed("change");

    state.isApplying = false;
    state.lastPush = Date.now();

    // Post-cycle warnings
    output.missingEnvVars(getMissingEnvVars(config as ProjectConfig, lookupEnvVar));
    const hardcoded = detectHardcodedSecrets(join(cwd, "supabase"), currentLayers);
    output.hardcodedSecrets(hardcoded);
    if (lookupEnvVar) {
      output.missingSecrets(detectMissingSecrets(config as ProjectConfig, lookupEnvVar));
    }

    if (state.pendingSchemaChanges.size > 0 || state.pendingConfigChange || state.pendingSeedChange) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => applyPendingChanges(), debounceMs);
    }
  };

  // --- Hooks at startup ---
  const hooksConfig = (config as Record<string, unknown>).hooks as HooksConfig | undefined;
  if (hooksConfig?.pre_push) {
    output.hookStart();
    try {
      await runHooksAsync(hooksConfig.pre_push, cwd, (msg) => output.hookCommand(msg));
      output.hookComplete();
    } catch (err) {
      output.hookError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
  }

  // --- Emit "running" status ---
  // (TTY: noop; JSON: emits { status: "running" } event)
  const hookWatchSources = getHookWatchSources(hooksConfig?.pre_push, cwd);
  output.running({
    profile: profile?.name,
    projectRef,
    branch: currentBranch,
    schemaDir: relative(cwd, schemaDir),
    seedEnabled,
    seedPaths: seedEnabled ? seedPaths : undefined,
    hooksEnabled: !!hooksConfig?.pre_push,
    hookWatchPaths: hookWatchSources.length > 0 ? hookWatchSources.map((s) => s.raw) : undefined,
  });

  // --- File watch sources (unified for both modes) ---
  const hookSources = getHookWatchSources(hooksConfig?.pre_push, cwd);
  for (const src of hookSources) output.verboseLog(`watching: ${src.raw} → ${src.dir}`);

  const watchSources: WatchSource[] = [
    {
      path: schemaDir,
      filter: (filePath) => filePath.endsWith(".sql"),
      onChange: (event, filePath) => {
        const relPath = relative(schemaDir, filePath);
        output.fileChanged(relPath, event);
        state.pendingSchemaChanges.add(relPath);
        scheduleDebounce();
      },
    },
    {
      path: configPath,
      onChange: (event, _filePath) => {
        output.configFileChanged("config.json", event);
        state.pendingConfigChange = true;
        scheduleDebounce();
      },
    },
    ...getOverlayPaths().map((overlayPath) => ({
      path: overlayPath,
      onChange: (event: string, _filePath: string) => {
        output.configFileChanged(basename(overlayPath), event);
        state.pendingConfigChange = true;
        scheduleDebounce();
      },
    })),
    ...(seedEnabled && existsSync(seedDir)
      ? [{
          path: seedDir,
          filter: (filePath: string) => filePath.endsWith(".sql"),
          onChange: (event: string, filePath: string) => {
            const relPath = relative(seedDir, filePath);
            output.seedFileChanged(relPath, event);
            state.pendingSeedChange = true;
            scheduleDebounce();
          },
        }]
      : []),
    ...hookSources.map((src) => ({
      path: src.dir,
      filter: src.filter,
      onChange: async (event: string, filePath: string) => {
        if (state.isApplying || isRunningHooks) return;
        output.fileChanged(relative(cwd, filePath), event, "hook");
        isRunningHooks = true;
        output.hookStart();
        try {
          await runHooksAsync(hooksConfig!.pre_push!, cwd, (msg) => output.hookCommand(msg));
          output.hookComplete();
        } catch (err) {
          output.hookError(err instanceof Error ? err.message : String(err));
        } finally {
          isRunningHooks = false;
        }
      },
    })),
  ];

  // --- Types tracking ---
  let lastTypesRefreshTime = 0;

  // --- Initial sync ---
  output.initialSyncStart();
  try {
    if (options.dryRun) {
      output.verboseLog(`pg-delta: computing diff…`);
      const diff = await diffSchemaWithPgDelta(connectionString, schemaDir);
      output.verboseLog(`pg-delta: ${diff.hasChanges ? `${diff.statements.length} statement(s)` : "no changes"}`);
      output.initialSyncPlan(diff.hasChanges, diff.statements);
      if (seedEnabled) {
        const existingSeedFiles = findSeedFiles(seedPaths, supabaseDir);
        if (existingSeedFiles.length > 0) output.seedPlan(existingSeedFiles.length);
      }
    } else {
      output.verboseLog(`db: starting initial sync against ${projectRef}`);
      if (lastPasswordRotationCompletedAt) {
        output.verboseLog(`db: first connect ${Date.now() - lastPasswordRotationCompletedAt}ms after password rotation`);
      }
      output.verboseLog(`db: connecting as postgres`);
      output.verboseLog(`pg-delta: applying schema…`);
      const schemaResult = await applySchemaWithRetry({
        connectionString,
        schemaDir,
        output,
        lastPasswordRotationCompletedAt,
      });
      output.verboseLog(`pg-delta: ${schemaResult.success ? `${schemaResult.statements ?? 0} statement(s) applied` : `failed — ${schemaResult.output?.slice(0, 80)}`}`);

      if (!schemaResult.success) {
        output.initialSyncSchemaFailed(schemaResult.output);
        process.exitCode = 1;
        return;
      }

      const schemaChanged = schemaResult.output !== "No changes to apply";
      const schemaStatements = schemaResult.statements ?? 0;

      // Config
      output.verboseLog(`config: syncing…`);
      let configChanges: ConfigChange[] = [];
      let startupLookupEnvVar: ((key: string) => string | undefined) | undefined;
      const { config: freshConfig, layers: freshStartupLayers } = loadEffectiveConfig(cwd, undefined, currentBranch);
      if (freshConfig) {
        try {
          currentLayers = freshStartupLayers;
          const { changes, lookupEnvVar, strippedSecrets } = await syncConfig(freshConfig as ProjectConfig);
          if (strippedSecrets.length > 0) output.hardcodedSecrets(strippedSecrets);
          output.verboseLog(`config: ${changes.length} change(s)`);
          configChanges = changes;
          startupLookupEnvVar = lookupEnvVar;
          config = freshConfig as ProjectConfig;
          await commitAllConfigSnapshots(cwd, parentProjectRef, currentBranch ?? "main");
          await reconcileConfig();
        } catch (error) {
          output.logNested(`${C.warning}⚠${C.reset} Config sync failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Types (if schema changed)
      if (schemaChanged) {
        const generated: string[] = [];
        const typesResult = await refreshTypesAndCodegen({
          getTypes: () => client.getTypescriptTypes(state.projectRef!, "public"),
          cwd,
          config,
          onGenerated: (f) => generated.push(f),
          onLog: options.verbose ? (msg) => output.verboseLog(msg) : undefined,
          onRetry: (n, delay, max) => output.typesRetry(n, delay, max),
        });
        if (typesResult.typesRefreshed) {
          output.typesUpdated(relative(cwd, typesPath), generated);
          lastTypesRefreshTime = Date.now();
        } else if (typesResult.error) {
          output.typesError(typesResult.error);
        }
      }

      output.initialSyncComplete({ schemaChanged, schemaStatements, configChanges: configChanges.length, dryRun: false });

      if (configChanges.length > 0) output.logConfigChanges(configChanges);

      if (seedEnabled && !state.seedApplied) await applySeed("initial");

      output.missingEnvVars(getMissingEnvVars(config as ProjectConfig, startupLookupEnvVar));
      if (startupLookupEnvVar) {
        output.missingSecrets(detectMissingSecrets(config as ProjectConfig, startupLookupEnvVar));
      }
    }
  } catch (error) {
    output.initialSyncError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  // --- Start file watcher (after initial sync to avoid duplicate pushes) ---
  const fileWatcher = createFileWatcher(watchSources, {
    onReady: (watched) => {
      const dirs = Object.keys(watched);
      output.verboseLog(`watcher ready: ${dirs.length} dirs`);
      for (const dir of dirs) {
        output.verboseLog(`  ${dir}: ${watched[dir].join(", ")}`);
      }
    },
  });

  // --- Types refresh interval ---
  let lastTypes = "";
  const typesCheck = setInterval(async () => {
    try {
      const resp = await client.getTypescriptTypes(state.projectRef!, "public");
      if (resp.types !== lastTypes) {
        lastTypes = resp.types;
        writeFileSync(typesPath, resp.types);
        const generated = runCodegenIfStale(cwd, config) ?? [];
        output.typesUpdated(relative(cwd, typesPath), generated);
      }
    } catch (err) {
      output.typesError(err instanceof Error ? err.message : "Unknown error");
    }
  }, typesIntervalMs);

  output.startHeartbeat();

  // --- Graceful shutdown ---
  const cleanup = async () => {
    output.stopHeartbeat();
    if (cleanupBranchWatch) cleanupBranchWatch();
    if (debounceTimer) clearTimeout(debounceTimer);
    clearInterval(typesCheck);
    await fileWatcher.close();
    await closeSupabasePool();
    output.stopped();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
