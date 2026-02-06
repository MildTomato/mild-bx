/**
 * Dev command - watch for schema and config changes and sync to remote
 *
 * Similar to `supa push` but runs continuously, watching for changes
 * and automatically applying them.
 */

import { watch as chokidarWatch } from "chokidar";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { createClient } from "@/lib/api.js";
import {
  getAccessToken,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
  getProfileForBranch,
  type Profile,
} from "@/lib/config.js";
import { getCurrentBranch } from "@/lib/git.js";
import {
  diffSchemaWithPgDelta,
  applySchemaWithPgDelta,
  applySeedFiles,
  findSeedFiles,
  setVerbose,
  closeSupabasePool,
} from "@/lib/pg-delta.js";
import { getSeedConfig } from "@/lib/seed-config.js";
import { C } from "@/lib/colors.js";
import { printCommandHeader, S_BAR } from "@/components/command-header.js";
import * as p from "@clack/prompts";
import {
  buildPostgrestPayload,
  buildAuthPayload,
  compareConfigs,
  type ProjectConfig,
  type ConfigDiff,
} from "@/lib/sync.js";
import { createSpinner } from "@/lib/spinner.js";

// Heartbeat frames for idle state
const HEARTBEAT_FRAMES = ["⠏", "⠇", "⠧", "⠦", "⠴", "⠼", "⠸", "⠹", "⠙", "⠋"];

// Format config value for display
function formatConfigValue(value: unknown): string {
  if (value === undefined || value === null) return "unset";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value.length > 25 ? value.slice(0, 22) + "..." : value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  return String(value).slice(0, 25);
}

// Clack-style symbols (S_BAR imported from command-header)
const S_STEP_SUBMIT = C.success + "◇" + C.reset;
const S_STEP_ERROR = C.error + "■" + C.reset;

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
  connectionString?: string;
  pendingSchemaChanges: Set<string>;
  pendingConfigChange: boolean;
  pendingSeedChange: boolean;
  lastPush: number;
  isApplying: boolean;
  seedApplied: boolean;
}

export async function devCommand(options: DevOptions): Promise<void> {
  const cwd = process.cwd();
  const schemaDir = join(cwd, "supabase", "schema");

  // Set verbose mode for pg-delta logging
  setVerbose(options.verbose ?? false);

  // Parse debounce interval
  let debounceMs = 500; // default 500ms
  if (options.debounce) {
    const match = options.debounce.match(/^(\d+)(ms|s)?$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2] || "ms";
      debounceMs = value * (unit === "s" ? 1000 : 1);
    }
  }

  // Parse types interval
  let typesIntervalMs = 30000; // default 30s
  if (options.typesInterval) {
    const match = options.typesInterval.match(/^(\d+)(s|m)?$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2] || "s";
      typesIntervalMs = value * (unit === "m" ? 60000 : 1000);
    }
  }

  // Load config
  const config = loadProjectConfig(cwd);
  if (!config) {
    if (options.json) {
      console.log(
        JSON.stringify({ status: "error", message: "No config found" }),
      );
    } else {
      console.error(
        `\n${C.error}Error:${C.reset} No supabase/config.json found`,
      );
      console.error(`  Run ${C.value}supa init${C.reset} to initialize\n`);
    }
    process.exitCode = 1;
    return;
  }

  // Get token
  const token = getAccessToken();
  if (!token) {
    if (options.json) {
      console.log(
        JSON.stringify({ status: "error", message: "Not authenticated" }),
      );
    } else {
      console.error(`\n${C.error}Error:${C.reset} Not authenticated`);
      console.error(`  Set SUPABASE_ACCESS_TOKEN environment variable\n`);
    }
    process.exitCode = 1;
    return;
  }

  // Check for db password
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "SUPABASE_DB_PASSWORD not set",
        }),
      );
    } else {
      console.error(
        `\n${C.error}Error:${C.reset} SUPABASE_DB_PASSWORD environment variable is required`,
      );
      console.error(
        `  Get your database password from the Supabase dashboard\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  // Check schema directory exists
  if (!existsSync(schemaDir)) {
    if (options.json) {
      console.log(
        JSON.stringify({ status: "error", message: "No schema directory" }),
      );
    } else {
      console.error(
        `\n${C.error}Error:${C.reset} No supabase/schema directory found`,
      );
      console.error(
        `  Run ${C.value}supa schema pull${C.reset} to initialize\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  // Get current state
  let currentBranch = getCurrentBranch(cwd) || "unknown";
  let profile = getProfileOrAuto(config, options.profile, currentBranch);
  let projectRef = getProjectRef(config, profile);

  if (!projectRef) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "No project_id configured",
        }),
      );
    } else {
      console.error(`\n${C.error}Error:${C.reset} No project_id configured`);
      console.error(`  Add "project_id" to supabase/config.json\n`);
    }
    process.exitCode = 1;
    return;
  }

  // Get connection string
  const client = createClient(token);

  // Check project status and wait if coming up
  const isProjectReady = (status: string) =>
    status === "ACTIVE_HEALTHY" || status === "ACTIVE_UNHEALTHY";

  // Check if db and pooler services are healthy
  const checkServicesHealth = async (): Promise<{
    ready: boolean;
    status: string;
  }> => {
    try {
      const health = await client.getProjectHealth(projectRef, [
        "db",
        "pooler",
      ]);
      const dbHealth = health.find((h) => h.name === "db");
      const poolerHealth = health.find((h) => h.name === "pooler");

      const dbReady = dbHealth?.status === "ACTIVE_HEALTHY";
      const poolerReady = poolerHealth?.status === "ACTIVE_HEALTHY";

      if (dbReady && poolerReady) {
        return { ready: true, status: "healthy" };
      }

      const statuses: string[] = [];
      if (dbHealth) statuses.push(`db: ${dbHealth.status}`);
      if (poolerHealth) statuses.push(`pooler: ${poolerHealth.status}`);
      return { ready: false, status: statuses.join(", ") || "checking" };
    } catch {
      // Health endpoint might not be available yet
      return { ready: false, status: "checking" };
    }
  };

  const waitForProject = async (): Promise<boolean> => {
    const maxWaitMs = 180000; // 3 minutes max
    const pollIntervalMs = 2000; // Check every 2 seconds
    const startTime = Date.now();
    let spinnerFrame = 0;
    let lastStatus = "";
    let lastPhase = "project"; // "project" or "services"
    let pollCount = 0;

    // Status-specific messages
    const getStatusMessage = (status: string): string => {
      switch (status) {
        case "COMING_UP":
          return "Starting services";
        case "GOING_DOWN":
          return "Shutting down";
        case "RESTORING":
          return "Restoring from backup";
        case "UPGRADING":
          return "Upgrading";
        case "PAUSING":
          return "Pausing";
        default:
          return status.toLowerCase().replace(/_/g, " ");
      }
    };

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const project = await client.getProject(projectRef);
        const statusChanged =
          lastStatus !== "" && lastStatus !== project.status;
        lastStatus = project.status;
        pollCount++;

        if (project.status === "INACTIVE") {
          if (options.json) {
            console.log(
              JSON.stringify({
                status: "error",
                message: "Project is paused",
                hint: "Restore the project from the Supabase dashboard",
                dashboardUrl: `https://supabase.com/dashboard/project/${projectRef}`,
              }),
            );
          } else {
            process.stdout.write("\r\x1b[K");
            console.error(`\n${C.error}Error:${C.reset} Project is paused`);
            console.error(
              `  Restore from: ${C.value}https://supabase.com/dashboard/project/${projectRef}${C.reset}\n`,
            );
          }
          return false;
        }

        if (isProjectReady(project.status)) {
          // Project is active, now check if db and pooler are healthy
          if (lastPhase === "project") {
            lastPhase = "services";
            if (!options.json) {
              process.stdout.write("\r\x1b[K");
              console.log(`${C.success}✓${C.reset} Project is active`);
            }
          }

          const servicesHealth = await checkServicesHealth();
          if (servicesHealth.ready) {
            return true;
          }

          // Services not ready yet - keep waiting
          if (!options.json) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const char = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
            process.stdout.write(
              `\r${C.icon}${char}${C.reset} Waiting for database... ${C.secondary}(${servicesHealth.status}) ${elapsed}s${C.reset}\x1b[K`,
            );
            spinnerFrame++;
          } else {
            console.log(
              JSON.stringify({
                event: "waiting_for_services",
                services_status: servicesHealth.status,
                elapsed_ms: Date.now() - startTime,
                poll_count: pollCount,
              }),
            );
          }

          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          continue;
        }

        // Project is in a transitional state - wait and retry
        if (!options.json) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const char = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
          const statusMsg = getStatusMessage(project.status);

          // Show status change on new line if status changed
          if (statusChanged) {
            process.stdout.write("\r\x1b[K");
            console.log(
              `${C.secondary}→${C.reset} Status: ${C.value}${statusMsg}${C.reset}`,
            );
          }

          process.stdout.write(
            `\r${C.icon}${char}${C.reset} ${statusMsg}... ${C.secondary}${elapsed}s${C.reset}\x1b[K`,
          );
          spinnerFrame++;
        } else {
          console.log(
            JSON.stringify({
              event: "waiting_for_project",
              status: project.status,
              elapsed_ms: Date.now() - startTime,
              poll_count: pollCount,
            }),
          );
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        if (options.json) {
          console.log(
            JSON.stringify({
              status: "error",
              message: `Failed to check project status: ${error instanceof Error ? error.message : String(error)}`,
            }),
          );
        } else {
          process.stdout.write("\r\x1b[K");
          console.error(
            `\n${C.error}Error:${C.reset} Failed to check project status`,
          );
          console.error(
            `  ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
        return false;
      }
    }

    // Timed out waiting
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: `Timed out waiting for project after ${elapsed}s (last status: ${lastStatus})`,
          hint: "Check the Supabase dashboard for project status",
        }),
      );
    } else {
      process.stdout.write("\r\x1b[K");
      console.error(
        `\n${C.error}Error:${C.reset} Timed out after ${C.value}${elapsed}s${C.reset} (status: ${C.value}${lastStatus}${C.reset})`,
      );
      console.error(
        `  Check: ${C.value}https://supabase.com/dashboard/project/${projectRef}${C.reset}\n`,
      );
    }
    return false;
  };

  try {
    const project = await client.getProject(projectRef);

    if (project.status === "INACTIVE") {
      if (options.json) {
        console.log(
          JSON.stringify({
            status: "error",
            message: "Project is paused",
            hint: "Restore the project from the Supabase dashboard",
            dashboardUrl: `https://supabase.com/dashboard/project/${projectRef}`,
          }),
        );
      } else {
        console.error(`\n${C.error}Error:${C.reset} Project is paused`);
        console.error(
          `  Restore from: ${C.value}https://supabase.com/dashboard/project/${projectRef}${C.reset}\n`,
        );
      }
      process.exitCode = 1;
      return;
    }

    if (!isProjectReady(project.status)) {
      // Project is in a transitional state - wait for it
      if (!options.json) {
        console.log(
          `\n${C.secondary}Project is starting up (${C.value}${project.status}${C.reset}${C.secondary}), waiting...${C.reset}`,
        );
      }

      const ready = await waitForProject();
      if (!ready) {
        process.exitCode = 1;
        return;
      }

      if (!options.json) {
        process.stdout.write("\r\x1b[K"); // Clear the spinner line
        console.log(`${C.success}✓${C.reset} Database is ready\n`);
      }
    } else {
      // Project is active but check if services are ready (newly created projects)
      const servicesHealth = await checkServicesHealth();
      if (!servicesHealth.ready) {
        if (!options.json) {
          console.log(
            `\n${C.secondary}Waiting for database services...${C.reset}`,
          );
        }

        const ready = await waitForProject();
        if (!ready) {
          process.exitCode = 1;
          return;
        }

        if (!options.json) {
          process.stdout.write("\r\x1b[K"); // Clear the spinner line
          console.log(`${C.success}✓${C.reset} Database is ready\n`);
        }
      }
    }
  } catch (error) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: `Failed to check project status: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    } else {
      console.error(
        `\n${C.error}Error:${C.reset} Failed to check project status`,
      );
      console.error(
        `  ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    process.exitCode = 1;
    return;
  }
  let connectionString: string | undefined;

  try {
    const poolerConfig = await client.getPoolerConfig(projectRef);
    const sessionPooler = poolerConfig.find(
      (p) => p.pool_mode === "session" && p.database_type === "PRIMARY",
    );
    const fallbackPooler = poolerConfig.find(
      (p) => p.database_type === "PRIMARY",
    );
    const pooler = sessionPooler || fallbackPooler;

    if (pooler?.connection_string) {
      connectionString = pooler.connection_string
        .replace("[YOUR-PASSWORD]", dbPassword)
        .replace(":6543/", ":5432/");
    }
  } catch (error) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "Failed to get connection string",
        }),
      );
    } else {
      console.error(
        `\n${C.error}Error:${C.reset} Failed to get database connection`,
      );
      console.error(
        `  ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  if (!connectionString) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "No connection string available",
        }),
      );
    } else {
      console.error(
        `\n${C.error}Error:${C.reset} No database connection available`,
      );
    }
    process.exitCode = 1;
    return;
  }

  // Config file path
  const configPath = join(cwd, "supabase", "config.json");

  // Get seed configuration
  const seedConfig = getSeedConfig(config, options);
  const seedEnabled = seedConfig.enabled;
  const seedPaths = seedConfig.paths;
  const supabaseDir = join(cwd, "supabase");
  const seedDir = join(supabaseDir, "seeds");

  // State
  const state: DevState = {
    profile,
    projectRef,
    connectionString,
    pendingSchemaChanges: new Set(),
    pendingConfigChange: false,
    pendingSeedChange: false,
    lastPush: 0,
    isApplying: false,
    seedApplied: false,
  };

  // JSON mode - output events as NDJSON
  if (options.json) {
    console.log(
      JSON.stringify({
        status: "running",
        profile: profile?.name,
        projectRef,
        branch: currentBranch,
        schemaDir: relative(cwd, schemaDir),
        seedEnabled,
        seedPaths: seedEnabled ? seedPaths : undefined,
      }),
    );

    let lastBranch = currentBranch;
    let debounceTimer: NodeJS.Timeout | null = null;

    // Branch watcher
    const branchCheck = setInterval(() => {
      const newBranch = getCurrentBranch(cwd);
      if (newBranch && newBranch !== lastBranch) {
        lastBranch = newBranch;
        const matched = getProfileForBranch(config, newBranch);
        console.log(
          JSON.stringify({
            event: matched ? "profile_changed" : "branch_changed",
            branch: newBranch,
            profile: matched?.name,
          }),
        );

        if (matched) {
          state.profile = matched;
          state.projectRef = getProjectRef(config, matched);
        }
      }
    }, 5000);

    // File watcher (schema + config)
    const watcher = chokidarWatch([schemaDir, configPath], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });

    watcher.on("all", async (event, filePath) => {
      const isConfig = basename(filePath) === "config.json";
      const isSchema = filePath.endsWith(".sql");

      if (!isConfig && !isSchema) return;

      if (isConfig) {
        console.log(JSON.stringify({ event: "config_changed", type: event }));
        state.pendingConfigChange = true;
      } else {
        const relPath = relative(schemaDir, filePath);
        console.log(
          JSON.stringify({ event: "file_changed", type: event, path: relPath }),
        );
        state.pendingSchemaChanges.add(relPath);
      }

      // Debounce
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (
          state.isApplying ||
          (state.pendingSchemaChanges.size === 0 && !state.pendingConfigChange)
        )
          return;

        state.isApplying = true;
        const schemaChanges = [...state.pendingSchemaChanges];
        const configChanged = state.pendingConfigChange;
        state.pendingSchemaChanges.clear();
        state.pendingConfigChange = false;

        // Apply config changes
        if (configChanged) {
          console.log(JSON.stringify({ event: "config_sync_start" }));
          try {
            const freshConfig = loadProjectConfig(cwd) as ProjectConfig;
            if (freshConfig) {
              let appliedCount = 0;

              const postgrestPayload = buildPostgrestPayload(freshConfig);
              if (
                postgrestPayload &&
                Object.keys(postgrestPayload).length > 0
              ) {
                if (options.dryRun) {
                  const remoteConfig = await client.getPostgrestConfig(
                    state.projectRef!,
                  );
                  const diffs = compareConfigs(
                    postgrestPayload as Record<string, unknown>,
                    remoteConfig as Record<string, unknown>,
                  );
                  console.log(
                    JSON.stringify({
                      event: "config_diff",
                      type: "api",
                      changes: diffs.filter((d) => d.changed),
                    }),
                  );
                } else {
                  await client.updatePostgrestConfig(
                    state.projectRef!,
                    postgrestPayload,
                  );
                  appliedCount++;
                }
              }

              const authPayload = buildAuthPayload(freshConfig);
              if (authPayload && Object.keys(authPayload).length > 0) {
                if (options.dryRun) {
                  const remoteConfig = await client.getAuthConfig(
                    state.projectRef!,
                  );
                  const diffs = compareConfigs(
                    authPayload as Record<string, unknown>,
                    remoteConfig as Record<string, unknown>,
                  );
                  console.log(
                    JSON.stringify({
                      event: "config_diff",
                      type: "auth",
                      changes: diffs.filter((d) => d.changed),
                    }),
                  );
                } else {
                  await client.updateAuthConfig(state.projectRef!, authPayload);
                  appliedCount++;
                }
              }

              console.log(
                JSON.stringify({
                  event: "config_sync_complete",
                  dryRun: options.dryRun ?? false,
                  applied: appliedCount,
                }),
              );
            }
          } catch (error) {
            console.log(
              JSON.stringify({
                event: "config_sync_error",
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        }

        // Apply schema changes
        if (schemaChanges.length > 0) {
          console.log(
            JSON.stringify({ event: "sync_start", files: schemaChanges }),
          );

          try {
            if (options.dryRun) {
              const diff = await diffSchemaWithPgDelta(
                state.connectionString!,
                schemaDir,
              );
              console.log(
                JSON.stringify({
                  event: "sync_plan",
                  hasChanges: diff.hasChanges,
                  statements: diff.statements,
                }),
              );
            } else {
              const result = await applySchemaWithPgDelta(
                state.connectionString!,
                schemaDir,
              );
              console.log(
                JSON.stringify({
                  event: result.success ? "sync_complete" : "sync_error",
                  success: result.success,
                  output: result.output,
                  statements: result.statements,
                }),
              );
            }
          } catch (error) {
            console.log(
              JSON.stringify({
                event: "sync_error",
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        }

        state.isApplying = false;
      }, debounceMs);
    });

    // Types refresh interval
    let lastTypes = "";
    const typesCheck = setInterval(async () => {
      try {
        const resp = await client.getTypescriptTypes(
          state.projectRef!,
          "public",
        );
        if (resp.types !== lastTypes) {
          lastTypes = resp.types;
          const typesPath = join(cwd, "supabase", "types", "database.ts");
          mkdirSync(dirname(typesPath), { recursive: true });
          writeFileSync(typesPath, resp.types);
          console.log(
            JSON.stringify({
              event: "types_updated",
              path: relative(cwd, typesPath),
            }),
          );
        }
      } catch (err) {
        console.log(
          JSON.stringify({
            event: "types_error",
            message: err instanceof Error ? err.message : "Unknown error",
          }),
        );
      }
    }, typesIntervalMs);

    // Initial sync - apply any pending schema changes
    console.log(JSON.stringify({ event: "initial_sync_start" }));
    try {
      if (options.dryRun) {
        const diff = await diffSchemaWithPgDelta(connectionString, schemaDir);
        console.log(
          JSON.stringify({
            event: "initial_sync_plan",
            hasChanges: diff.hasChanges,
            statements: diff.statements,
          }),
        );
        // Show seed info in dry-run
        if (seedEnabled) {
          const existingSeedFiles = findSeedFiles(seedPaths, supabaseDir);
          if (existingSeedFiles.length > 0) {
            console.log(
              JSON.stringify({
                event: "seed_plan",
                files: existingSeedFiles.length,
              }),
            );
          }
        }
      } else {
        const result = await applySchemaWithPgDelta(
          connectionString,
          schemaDir,
        );
        console.log(
          JSON.stringify({
            event: result.success
              ? "initial_sync_complete"
              : "initial_sync_error",
            success: result.success,
            output: result.output,
            statements: result.statements,
          }),
        );

        // Apply seed after initial sync (JSON mode)
        if (result.success && seedEnabled) {
          const existingSeedFiles = findSeedFiles(seedPaths, supabaseDir);
          if (existingSeedFiles.length > 0) {
            console.log(
              JSON.stringify({
                event: "seed_start",
                files: existingSeedFiles.length,
              }),
            );
            try {
              const seedResult = await applySeedFiles(
                connectionString,
                seedPaths,
                supabaseDir,
              );
              console.log(
                JSON.stringify({
                  event: seedResult.success ? "seed_complete" : "seed_error",
                  filesApplied: seedResult.filesApplied,
                  totalFiles: seedResult.totalFiles,
                  errors: seedResult.errors,
                }),
              );
            } catch (seedError) {
              console.log(
                JSON.stringify({
                  event: "seed_error",
                  error:
                    seedError instanceof Error
                      ? seedError.message
                      : String(seedError),
                }),
              );
            }
          }
        }
      }
    } catch (error) {
      console.log(
        JSON.stringify({
          event: "initial_sync_error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    // Cleanup
    process.on("SIGINT", async () => {
      clearInterval(branchCheck);
      clearInterval(typesCheck);
      watcher.close();
      await closeSupabasePool();
      console.log(JSON.stringify({ status: "stopped" }));
      process.exit(0);
    });

    return;
  }

  // Interactive mode - Clack-style rail UI
  let currentLine = "";
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let heartbeatFrame = 0;
  let lastActivity = Date.now();
  let debounceTimer: NodeJS.Timeout | null = null;
  let isSpinnerActive = false;
  const spinner = createSpinner();

  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  const clearLine = () => {
    if (currentLine) {
      const len = stripAnsi(currentLine).length;
      process.stdout.write(`\r${" ".repeat(len)}\r`);
      currentLine = "";
    }
  };

  const writeLine = (msg: string) => {
    clearLine();
    process.stdout.write(`\r${msg}\x1b[K`);
    currentLine = msg;
  };

  // Log a line with the rail
  const logRail = (msg: string) => {
    clearLine();
    console.log(`${S_BAR}  ${msg}`);
    lastActivity = Date.now();
  };

  // Log a completed step with inline summary
  const logStep = (msg: string, summary?: string) => {
    clearLine();
    if (summary) {
      console.log(`${S_STEP_SUBMIT}  ${msg} ${C.secondary}·${C.reset} ${C.secondary}${summary}${C.reset}`);
    } else {
      console.log(`${S_STEP_SUBMIT}  ${msg}`);
    }
    lastActivity = Date.now();
  };

  // Log an error step
  const logError = (msg: string) => {
    clearLine();
    console.log(`${S_STEP_ERROR}  ${msg}`);
    lastActivity = Date.now();
  };

  // Log a nested item under a step
  const logNested = (msg: string) => {
    clearLine();
    console.log(`${S_BAR}  ${C.secondary}${msg}${C.reset}`);
  };

  // Start an active step with Clack spinner
  const startStep = (msg: string) => {
    lastActivity = Date.now();
    stopHeartbeat();
    heartbeatStarted = false; // Reset so we get space before next idle
    isSpinnerActive = true;
    spinner.start(msg);
  };

  // Complete an active step
  // status: "success" | "warning" | "error"
  const completeStep = (msg: string, summary?: string, status: "success" | "warning" | "error" = "success", detail?: string) => {
    isSpinnerActive = false;
    if (summary) {
      spinner.stop(`${msg} ${C.secondary}·${C.reset} ${C.secondary}${summary}${C.reset}`);
    } else {
      spinner.stop(msg);
    }
    // Show detail as nested text with appropriate color
    if (detail) {
      clearLine();
      const color = status === "error" ? C.error : status === "warning" ? C.warning : C.secondary;
      console.log(`${S_BAR}  ${color}${detail}${C.reset}`);
      lastActivity = Date.now();
    }
    startHeartbeat();
  };

  let heartbeatStarted = false;

  const startHeartbeat = () => {
    if (heartbeatInterval) return;

    heartbeatInterval = setInterval(() => {
      const idle = Date.now() - lastActivity > 1000;
      if (idle && !isSpinnerActive) {
        // Add space before first heartbeat
        if (!heartbeatStarted) {
          console.log(S_BAR);
          heartbeatStarted = true;
        }
        const char = HEARTBEAT_FRAMES[heartbeatFrame % HEARTBEAT_FRAMES.length];
        writeLine(`${C.secondary}${char}  Watching for changes...${C.reset}`);
        heartbeatFrame++;
      }
    }, 350);
  };

  const stopHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };

  // Types tracking - shared between sync and interval
  let lastTypesContent = "";
  let lastTypesRefreshTime = 0;

  // Print Clack-style header
  printCommandHeader({
    command: "supa dev",
    description: ["Watch for schema and config changes."],
  });
  console.log(S_BAR);
  console.log(`${S_BAR}  ${C.secondary}Project:${C.reset}  ${projectRef}`);
  console.log(`${S_BAR}  ${C.secondary}Profile:${C.reset}  ${profile?.name || "default"}`);
  console.log(`${S_BAR}  ${C.secondary}Branch:${C.reset}   ${currentBranch}`);
  console.log(`${S_BAR}  ${C.secondary}Schema:${C.reset}   ${relative(cwd, schemaDir)}`);
  if (seedEnabled) {
    const seedDisplay = seedPaths.length === 1 ? seedPaths[0] : `${seedPaths.length} paths`;
    console.log(`${S_BAR}  ${C.secondary}Seed:${C.reset}     ${seedDisplay}`);
  }
  if (options.dryRun) {
    console.log(`${S_BAR}  ${C.warning}Mode:${C.reset}     ${C.warning}dry-run${C.reset}`);
  }

  let lastBranch = currentBranch;

  // Branch watcher
  let branchCheck: NodeJS.Timeout | undefined;
  if (!options.noBranchWatch) {
    branchCheck = setInterval(() => {
      const newBranch = getCurrentBranch(cwd);
      if (newBranch && newBranch !== lastBranch) {
        lastBranch = newBranch;
        const matched = getProfileForBranch(config, newBranch);

        if (matched && matched.name !== state.profile?.name) {
          state.profile = matched;
          state.projectRef = getProjectRef(config, matched);
          logRail(`→ Branch ${C.fileName}${newBranch}${C.reset} → profile ${C.value}${matched.name}${C.reset}`);
        } else {
          logRail(`→ Branch ${C.fileName}${newBranch}${C.reset}`);
        }
      }
    }, 5000);
  }

  // Apply config changes
  const applyConfigChanges = async () => {
    startStep("Pushing config");

    try {
      // Reload config from disk
      const freshConfig = loadProjectConfig(cwd) as ProjectConfig;
      if (!freshConfig) {
        completeStep("Config push failed", "could not reload", "error");
        return;
      }

      const allChanges: { key: string; oldValue: string; newValue: string }[] = [];

      // Build and apply postgrest config
      const postgrestPayload = buildPostgrestPayload(freshConfig);
      if (postgrestPayload && Object.keys(postgrestPayload).length > 0) {
        const remoteConfig = await client.getPostgrestConfig(state.projectRef!);
        const diffs = compareConfigs(
          postgrestPayload as Record<string, unknown>,
          remoteConfig as Record<string, unknown>,
        );
        const changedDiffs = diffs.filter((d) => d.changed);

        for (const diff of changedDiffs) {
          allChanges.push({
            key: `api.${diff.key}`,
            oldValue: formatConfigValue(diff.oldValue),
            newValue: formatConfigValue(diff.newValue),
          });
        }

        if (!options.dryRun && changedDiffs.length > 0) {
          await client.updatePostgrestConfig(state.projectRef!, postgrestPayload);
        }
      }

      // Build and apply auth config
      const authPayload = buildAuthPayload(freshConfig);
      if (authPayload && Object.keys(authPayload).length > 0) {
        const remoteConfig = await client.getAuthConfig(state.projectRef!);
        const diffs = compareConfigs(
          authPayload as Record<string, unknown>,
          remoteConfig as Record<string, unknown>,
        );
        const changedDiffs = diffs.filter((d) => d.changed);

        for (const diff of changedDiffs) {
          allChanges.push({
            key: `auth.${diff.key}`,
            oldValue: formatConfigValue(diff.oldValue),
            newValue: formatConfigValue(diff.newValue),
          });
        }

        if (!options.dryRun && changedDiffs.length > 0) {
          await client.updateAuthConfig(state.projectRef!, authPayload);
        }
      }

      if (allChanges.length === 0) {
        completeStep("Pushed", "no config changes");
      } else {
        const suffix = options.dryRun ? " (dry-run)" : "";
        completeStep("Pushed", `${allChanges.length} config change${allChanges.length === 1 ? "" : "s"}${suffix}`);

        // Show nested changes with old → new (orange old, white new)
        for (const change of allChanges.slice(0, 5)) {
          clearLine();
          console.log(`${S_BAR}  ${change.key}: ${C.warning}${change.oldValue}${C.reset} ${C.secondary}→${C.reset} ${C.value}${change.newValue}${C.reset}`);
          lastActivity = Date.now();
        }
        if (allChanges.length > 5) {
          logNested(`+${allChanges.length - 5} more`);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      completeStep("Config push failed", undefined, "error", msg);
    }
  };

  // Apply schema changes
  const applySchemaChanges = async (changedFiles: string[]) => {
    startStep("Pushing schema");

    try {
      if (options.dryRun) {
        // Dry run - just show the diff
        const diff = await diffSchemaWithPgDelta(
          state.connectionString!,
          schemaDir,
        );

        if (!diff.hasChanges) {
          completeStep("Pushed", "no schema changes");
        } else {
          completeStep("Pushed", `${diff.statements.length} statements (dry-run)`);
          for (const stmt of diff.statements.slice(0, 5)) {
            logNested(stmt.length > 60 ? stmt.slice(0, 57) + "..." : stmt);
          }
          if (diff.statements.length > 5) {
            logNested(`+${diff.statements.length - 5} more`);
          }
        }
      } else {
        // Actually apply
        const result = await applySchemaWithPgDelta(
          state.connectionString!,
          schemaDir,
        );

        if (result.success) {
          if (result.output === "No changes to apply") {
            completeStep("Pushed", "no schema changes");
          } else {
            completeStep("Pushed", `${result.statements ?? 0} statements`);

            // Show changed files as nested items
            for (const file of changedFiles.slice(0, 5)) {
              logNested(file);
            }
            if (changedFiles.length > 5) {
              logNested(`+${changedFiles.length - 5} more files`);
            }

            // Refresh types after successful schema change
            try {
              const typesResp = await client.getTypescriptTypes(
                state.projectRef!,
                "public",
              );
              const typesPath = join(cwd, "supabase", "types", "database.ts");
              mkdirSync(dirname(typesPath), { recursive: true });
              writeFileSync(typesPath, typesResp.types);
              lastTypesContent = typesResp.types;
              lastTypesRefreshTime = Date.now();
              logNested("Types refreshed");
            } catch {
              // Types refresh failed, not critical
            }
          }
        } else {
          completeStep("Push failed", undefined, "error", result.output);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      completeStep("Push failed", undefined, "error", msg);
    }
  };

  // Apply seed files
  const applySeed = async (reason: "initial" | "change" = "change") => {
    if (!seedEnabled || options.dryRun) return;

    // Check if there are any seed files
    const existingSeedFiles = findSeedFiles(seedPaths, supabaseDir);
    if (existingSeedFiles.length === 0) {
      return;
    }

    startStep("Seeding database");

    try {
      const result = await applySeedFiles(
        state.connectionString!,
        seedPaths,
        supabaseDir,
      );

      if (result.success) {
        completeStep("Seeded", `${result.filesApplied} files`);
      } else {
        const errorSummary = result.errors.slice(0, 2).map((e) => e.file).join(", ");
        completeStep("Seeded with errors", errorSummary, "warning");
      }
      state.seedApplied = true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      completeStep("Seed failed", undefined, "error", msg);
    }
  };

  // Apply pending changes
  const applyPendingChanges = async () => {
    if (state.isApplying) return;
    if (
      state.pendingSchemaChanges.size === 0 &&
      !state.pendingConfigChange &&
      !state.pendingSeedChange
    )
      return;

    state.isApplying = true;

    const schemaChanges = [...state.pendingSchemaChanges];
    const configChanged = state.pendingConfigChange;
    const seedChanged = state.pendingSeedChange;
    state.pendingSchemaChanges.clear();
    state.pendingConfigChange = false;
    state.pendingSeedChange = false;

    // Apply config first
    if (configChanged) {
      await applyConfigChanges();
    }

    // Then schema
    if (schemaChanges.length > 0) {
      await applySchemaChanges(schemaChanges);
    }

    // Then seeds (only if seed files changed, or after schema changes if --seed flag)
    if (seedChanged || (schemaChanges.length > 0 && options.seed)) {
      await applySeed("change");
    }

    state.isApplying = false;
    state.lastPush = Date.now();
  };

  // Build watch paths - schema, config, and optionally seeds
  const watchPaths = [schemaDir, configPath];
  if (seedEnabled && existsSync(seedDir)) {
    watchPaths.push(seedDir);
  }

  // File watcher (schema + config + seeds)
  const watcher = chokidarWatch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on("all", (event, filePath) => {
    const isConfig = basename(filePath) === "config.json";
    const isSchema =
      filePath.startsWith(schemaDir) && filePath.endsWith(".sql");
    const isSeed =
      seedEnabled && filePath.startsWith(seedDir) && filePath.endsWith(".sql");

    if (!isConfig && !isSchema && !isSeed) return;

    // Log the change with rail
    const eventIcon = event === "add" ? "+" : event === "unlink" ? "-" : "~";
    const eventColor =
      event === "add" ? C.success : event === "unlink" ? C.error : C.secondary;

    if (isConfig) {
      logRail(`${eventColor}${eventIcon}${C.reset} config.json`);
      state.pendingConfigChange = true;
    } else if (isSeed) {
      const relPath = relative(seedDir, filePath);
      logRail(`${eventColor}${eventIcon}${C.reset} seeds/${relPath}`);
      state.pendingSeedChange = true;
    } else {
      const relPath = relative(schemaDir, filePath);
      logRail(`${eventColor}${eventIcon}${C.reset} ${relPath}`);
      state.pendingSchemaChanges.add(relPath);
    }

    // Debounce changes
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      applyPendingChanges();
    }, debounceMs);
  });

  // Types refresh interval
  const typesCheck = setInterval(async () => {
    // Don't refresh during apply or if we just refreshed recently (within 10s)
    if (state.isApplying) return;
    if (Date.now() - lastTypesRefreshTime < 10000) return;

    try {
      const resp = await client.getTypescriptTypes(state.projectRef!, "public");
      if (resp.types !== lastTypesContent) {
        lastTypesContent = resp.types;
        lastTypesRefreshTime = Date.now();
        const typesPath = join(cwd, "supabase", "types", "database.ts");
        mkdirSync(dirname(typesPath), { recursive: true });
        writeFileSync(typesPath, resp.types);
        logRail(`${C.success}✓${C.reset} Types refreshed`);
      }
    } catch {
      // Silent failure for types refresh
    }
  }, typesIntervalMs);

  // Initial sync - apply any pending schema changes
  startStep("Syncing schema");
  try {
    if (options.dryRun) {
      // In dry-run mode, just show what would be applied
      const diff = await diffSchemaWithPgDelta(connectionString, schemaDir);
      if (diff.hasChanges) {
        completeStep("Synced", `${diff.statements.length} statements (dry-run)`);
        for (const stmt of diff.statements.slice(0, 5)) {
          logNested(stmt.length > 60 ? stmt.slice(0, 57) + "..." : stmt);
        }
        if (diff.statements.length > 5) {
          logNested(`+${diff.statements.length - 5} more`);
        }
      } else {
        completeStep("Synced", "schema up to date");
      }
      // Show seed info in dry-run mode
      if (seedEnabled) {
        const existingSeedFiles = findSeedFiles(seedPaths, supabaseDir);
        if (existingSeedFiles.length > 0) {
          logNested(`Would seed ${existingSeedFiles.length} file(s)`);
        }
      }
    } else {
      // Apply pending changes
      const result = await applySchemaWithPgDelta(connectionString, schemaDir);
      if (result.success) {
        if (result.output === "No changes to apply") {
          completeStep("Synced", "schema up to date");
        } else {
          completeStep("Synced", `${result.statements ?? 0} statements`);
          // Refresh types after initial sync
          try {
            const typesResp = await client.getTypescriptTypes(
              state.projectRef!,
              "public",
            );
            const typesPath = join(cwd, "supabase", "types", "database.ts");
            mkdirSync(dirname(typesPath), { recursive: true });
            writeFileSync(typesPath, typesResp.types);
            lastTypesContent = typesResp.types;
            lastTypesRefreshTime = Date.now();
            logNested("Types refreshed");
          } catch {
            // Types refresh failed, not critical
          }
        }

        // Apply initial seed if enabled and not already applied
        if (seedEnabled && !state.seedApplied) {
          await applySeed("initial");
        }
      } else {
        completeStep("Sync failed", undefined, "error", result.output);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    completeStep("Sync failed", undefined, "error", msg);
  }

  // Start heartbeat
  startHeartbeat();

  // Graceful shutdown
  const cleanup = async () => {
    stopHeartbeat();
    if (isSpinnerActive) spinner.stop();
    if (branchCheck) clearInterval(branchCheck);
    if (debounceTimer) clearTimeout(debounceTimer);
    clearInterval(typesCheck);
    watcher.close();
    await closeSupabasePool();
    clearLine();
    console.log(`${C.secondary}└${C.reset}`);
    console.log("");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
