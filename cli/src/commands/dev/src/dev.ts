/**
 * Dev command - watch for schema and config changes and sync to remote
 *
 * Similar to `supa push` but runs continuously, watching for changes
 * and automatically applying them.
 */

import { watch, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { createClient } from "@/lib/api.js";
import { SUPABASE_DASHBOARD_URL } from "@/lib/env.js";
import {
  requireAuth,
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
  setLogCallback,
  closeSupabasePool,
} from "@/lib/pg-delta.js";
import { getSeedConfig } from "@/lib/seed-config.js";
import { C } from "@/lib/colors.js";
import { generated as fmtGenerated, verboseLog } from "@/lib/styles.js";
import { printCommandHeader, printProjectContextLines, S_BAR } from "@/components/command-header.js";
import * as p from "@clack/prompts";
import { isTTY, log } from "@clack/prompts";
import {
  buildPostgrestPayload,
  buildAuthPayload,
  compareConfigs,
  type ProjectConfig,
  type ConfigDiff,
} from "@/lib/sync.js";
import { resolveBranchAndWriteEnv, writeProjectEnv } from "@/lib/env-file.js";
import { isBranchingProfile } from "@/lib/workflow-profiles.js";
import { getWorkflowProfile } from "@/lib/config.js";
import { checkEnvMatchesBranch, runCodegenIfStale, refreshTypesAndCodegen } from "@/lib/precheck.js";
import { runHooks, runHooksAsync, getHookWatchSources } from "@/lib/hooks.js";
import { createFileWatcher, type WatchSource } from "@/lib/file-watcher.js";
import type { HooksConfig } from "@supabase-dx/config";

function watchGitBranch(cwd: string, onChange: () => void): () => void {
  const gitHeadPath = join(cwd, ".git", "HEAD");
  let watcher: ReturnType<typeof watch> | null = null;
  let fallbackInterval: ReturnType<typeof setInterval> | null = null;

  try {
    watcher = watch(gitHeadPath, () => onChange());
    watcher.on("error", () => {
      // Fall back to polling if watcher fails
      watcher?.close();
      watcher = null;
      fallbackInterval = setInterval(onChange, 5000);
    });
  } catch {
    // .git/HEAD doesn't exist or watch not supported — fall back to polling
    fallbackInterval = setInterval(onChange, 5000);
  }

  // Return cleanup function
  return () => {
    watcher?.close();
    if (fallbackInterval) clearInterval(fallbackInterval);
  };
}

const SPINNER_FRAMES = ["◒", "◐", "◓", "◑"];

// Heartbeat frames for idle state
const HEARTBEAT_FRAMES = ["⠏", "⠇", "⠧", "⠦", "⠴", "⠼", "⠸", "⠹", "⠙", "⠋"];

// Format config value for display
function formatConfigValue(value: unknown): string {
  if (value === undefined || value === null) return "unset";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
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
  const isInteractive = isTTY(process.stdout);

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

  // Load config (mutable so it stays current after reloads)
  let config = loadProjectConfig(cwd);
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
  const token = await requireAuth({ json: options.json });

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
                dashboardUrl: `${SUPABASE_DASHBOARD_URL}/project/${projectRef}`,
              }),
            );
          } else {
            if (isInteractive) process.stdout.write("\r\x1b[K");
            console.error(`\n${C.error}Error:${C.reset} Project is paused`);
            console.error(
              `  Restore from: ${C.value}${SUPABASE_DASHBOARD_URL}/project/${projectRef}${C.reset}\n`,
            );
          }
          return false;
        }

        if (isProjectReady(project.status)) {
          // Project is active, now check if db and pooler are healthy
          if (lastPhase === "project") {
            lastPhase = "services";
            if (!options.json) {
              if (isInteractive) process.stdout.write("\r\x1b[K");
              console.log(`${C.success}✓${C.reset} Project is active`);
            }
          }

          const servicesHealth = await checkServicesHealth();
          if (servicesHealth.ready) {
            return true;
          }

          // Services not ready yet - keep waiting
          if (!options.json) {
            if (isInteractive) {
              const elapsed = Math.round((Date.now() - startTime) / 1000);
              const char = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
              process.stdout.write(
                `\r${C.icon}${char}${C.reset} Waiting for database... ${C.secondary}(${servicesHealth.status}) ${elapsed}s${C.reset}\x1b[K`,
              );
              spinnerFrame++;
            } else if (pollCount === 1) {
              console.log(`Waiting for database... (${servicesHealth.status})`);
            }
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
          const statusMsg = getStatusMessage(project.status);
          if (isInteractive) {
            // Animated spinner — only works in a real TTY (uses \r to overwrite the line)
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const char = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
            if (statusChanged) {
              process.stdout.write("\r\x1b[K");
              console.log(`${C.secondary}→${C.reset} Status: ${C.value}${statusMsg}${C.reset}`);
            }
            process.stdout.write(
              `\r${C.icon}${char}${C.reset} ${statusMsg}... ${C.secondary}${elapsed}s${C.reset}\x1b[K`,
            );
            spinnerFrame++;
          } else if (statusChanged || lastStatus === "") {
            // Non-TTY: log once per status change so output isn't flooded
            console.log(`${C.secondary}→${C.reset} ${statusMsg}...`);
          }
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
          if (isInteractive) process.stdout.write("\r\x1b[K");
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
        `  Check: ${C.value}${SUPABASE_DASHBOARD_URL}/project/${projectRef}${C.reset}\n`,
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
            dashboardUrl: `${SUPABASE_DASHBOARD_URL}/project/${projectRef}`,
          }),
        );
      } else {
        console.error(`\n${C.error}Error:${C.reset} Project is paused`);
        console.error(
          `  Restore from: ${C.value}${SUPABASE_DASHBOARD_URL}/project/${projectRef}${C.reset}\n`,
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
        if (isInteractive) process.stdout.write("\r\x1b[K"); // Clear the spinner line (TTY only)
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
  // Resolve credentials BEFORE building the connection string so we always
  // connect to the right database from the very start.
  //
  // For branching profiles we always call resolveBranchAndWriteEnv — even when
  // on the production branch. This is the only way to fix stale .env.local
  // credentials left over from a previous preview-branch session: the old
  // preview password overwrites SUPABASE_DB_PASSWORD in .env.local, and if
  // that file is loaded before .env at startup the wrong password reaches the
  // connection string. resolveBranchAndWriteEnv re-fetches the correct
  // password from the API for whichever branch we're on and updates both
  // process.env and .env.local before we connect.
  //
  // For non-branching profiles we fall back to writeProjectEnv which just
  // copies the existing process.env password into .env.local (no API fetch).
  const workflowProfile = getWorkflowProfile(config);

  if (isBranchingProfile(workflowProfile) && config.project_id) {
    const productionBranch = config.production_branch as string | undefined ?? "main";
    const isMainBranch = currentBranch === productionBranch || currentBranch === "master";

    let branchResult = await resolveBranchAndWriteEnv({
      cwd,
      gitBranch: currentBranch,
      mainProjectRef: config.project_id,
      token,
      productionBranch,
    });

    if (!branchResult && !isMainBranch) {
      // No preview branch for this git branch — create one via API directly.
      if (options.json) {
        console.error(JSON.stringify({ status: "info", message: `Creating preview branch for "${currentBranch}"` }));
      } else {
        log.step(`Creating preview branch for "${currentBranch}"…`);
      }

      const newBranch = await client.createBranch(config.project_id, {
        branch_name: currentBranch,
        git_branch: currentBranch,
      });

      // Poll until the preview project is healthy (up to 5 min)
      const BRANCH_POLL_MS = 5000;
      const BRANCH_MAX_POLLS = 60;
      const BRANCH_FAILED = new Set(["INIT_FAILED", "REMOVED", "RESTORE_FAILED", "PAUSE_FAILED"]);
      let branchHealthy = false;
      let branchPollFrame = 0;
      for (let i = 0; i < BRANCH_MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, BRANCH_POLL_MS));
        const branches = await client.listBranches(config.project_id);
        const b = branches.find((x) => x.id === newBranch.id);
        if (!b) break;
        if (isInteractive && !options.json) {
          const char = SPINNER_FRAMES[branchPollFrame % SPINNER_FRAMES.length];
          process.stdout.write(`\r${char}  Waiting for preview branch… (${b.preview_project_status ?? "provisioning"})\x1b[K`);
          branchPollFrame++;
        }
        if (b.preview_project_status === "ACTIVE_HEALTHY") { branchHealthy = true; break; }
        if (b.preview_project_status && BRANCH_FAILED.has(b.preview_project_status)) break;
      }
      if (isInteractive && !options.json) process.stdout.write("\r\x1b[K");

      if (!branchHealthy) {
        if (options.json) {
          console.error(JSON.stringify({ status: "error", message: "Preview branch not healthy", exitCode: 1 }));
        } else {
          log.error(`Preview branch created but not yet healthy. Try again in a moment.`);
        }
        process.exitCode = 1;
        return;
      }

      // Grace period for the project record to fully propagate
      await new Promise((r) => setTimeout(r, 5000));

      branchResult = await resolveBranchAndWriteEnv({
        cwd,
        gitBranch: currentBranch,
        mainProjectRef: config.project_id,
        token,
        productionBranch,
      });
      if (!branchResult) {
        if (options.json) {
          console.error(JSON.stringify({ status: "error", message: "Preview branch credentials unavailable", exitCode: 1 }));
        } else {
          log.error(`Preview branch created but credentials not available. Try again in a moment.`);
        }
        process.exitCode = 1;
        return;
      }
    }

    if (branchResult) {
      projectRef = branchResult.projectRef;
    }
  } else if (config.project_id) {
    // Non-branching profile — write main project credentials (fire-and-forget,
    // only refreshes .env.local, no need to block the connection string build)
    writeProjectEnv({ cwd, projectRef: config.project_id, token }).catch(() => {});
  }

  let connectionString: string | undefined;

  try {
    connectionString = await resolveConnectionString(
      client,
      projectRef,
      process.env.SUPABASE_DB_PASSWORD ?? dbPassword,
    );
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "Failed to get connection string" }));
    } else {
      console.error(`\n${C.error}Error:${C.reset} Failed to get database connection`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}\n`);
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

  // Warn if .env.local SUPABASE_URL doesn't match the resolved branch
  checkEnvMatchesBranch({ cwd, gitBranch: currentBranch, resolvedProjectRef: projectRef, config, json: options.json });

  // JSON mode - output events as NDJSON
  if (options.json) {
    const jsonHooksConfig = (config as Record<string, unknown>).hooks as HooksConfig | undefined;
    const jsonHookWatchSources = getHookWatchSources(jsonHooksConfig?.pre_push, cwd);
    console.log(
      JSON.stringify({
        status: "running",
        profile: profile?.name,
        projectRef,
        branch: currentBranch,
        schemaDir: relative(cwd, schemaDir),
        seedEnabled,
        seedPaths: seedEnabled ? seedPaths : undefined,
        hooksEnabled: !!jsonHooksConfig?.pre_push,
        hookWatchPaths: jsonHookWatchSources.length > 0 ? jsonHookWatchSources.map((s) => s.raw) : undefined,
      }),
    );

    let lastBranch = currentBranch;
    let debounceTimer: NodeJS.Timeout | null = null;
    let isResolvingBranchJson = false;

    // Branch watcher
    const cleanupBranchWatchJson = watchGitBranch(cwd, () => {
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

        const workflowProfile = getWorkflowProfile(config);
        if (isBranchingProfile(workflowProfile) && config.project_id) {
          if (!isResolvingBranchJson) {
            isResolvingBranchJson = true;
            resolveBranchAndWriteEnv({
              cwd,
              gitBranch: newBranch,
              mainProjectRef: config.project_id,
              token,
              productionBranch: config.production_branch as string | undefined,
            }).then(async (result) => {
              if (result) {
                state.projectRef = result.projectRef;
                // Rebuild connection string for the new project ref
                try {
                  const cs = await resolveConnectionString(
                    client,
                    result.projectRef,
                    process.env.SUPABASE_DB_PASSWORD ?? dbPassword,
                  );
                  if (cs) state.connectionString = cs;
                } catch {
                  // Non-fatal — keep existing connection string
                }
                console.log(
                  JSON.stringify({
                    event: "env_updated",
                    branch: newBranch,
                    projectRef: result.projectRef,
                    isBranch: result.isBranch,
                  }),
                );
              } else {
                console.log(
                  JSON.stringify({
                    event: "env_update_skipped",
                    branch: newBranch,
                    reason: "no_healthy_branch",
                  }),
                );
              }
            }).catch((err) => {
              console.log(
                JSON.stringify({
                  event: "env_update_error",
                  branch: newBranch,
                  error: err instanceof Error ? err.message : String(err),
                }),
              );
            }).finally(() => {
              isResolvingBranchJson = false;
            });
          }
        }
      }
    });

    // Run pre-push hooks on startup (e.g., ORM codegen)
    if (jsonHooksConfig?.pre_push) {
      try {
        runHooks(jsonHooksConfig.pre_push, cwd);
        console.log(JSON.stringify({ event: "hook_complete" }));
      } catch (err) {
        console.log(JSON.stringify({ event: "hook_error", error: err instanceof Error ? err.message : String(err) }));
      }
    }

    // File watcher (schema + config + hook watch paths)
    const jsonHookSources = getHookWatchSources(jsonHooksConfig?.pre_push, cwd);

    const jsonWatchSources: WatchSource[] = [
      {
        path: schemaDir,
        filter: (filePath) => filePath.endsWith(".sql"),
        onChange: async (event, filePath) => {
          const relPath = relative(schemaDir, filePath);
          console.log(
            JSON.stringify({ event: "file_changed", type: event, path: relPath }),
          );
          state.pendingSchemaChanges.add(relPath);
          scheduleDebounce();
        },
      },
      {
        path: configPath,
        onChange: async (event, _filePath) => {
          console.log(JSON.stringify({ event: "config_changed", type: event }));
          state.pendingConfigChange = true;
          scheduleDebounce();
        },
      },
      ...jsonHookSources.map((src) => ({
        path: src.dir,
        filter: src.filter,
        onChange: async (event: string, filePath: string) => {
          // Hook source changed — run hooks directly, schema watcher picks up generated files
          if (state.isApplying) return;
          console.log(JSON.stringify({ event: "file_changed", type: event, path: relative(cwd, filePath), source: "hook" }));
          try {
            runHooks(jsonHooksConfig!.pre_push!, cwd);
            console.log(JSON.stringify({ event: "hook_complete" }));
          } catch (err) {
            console.log(JSON.stringify({ event: "hook_error", error: err instanceof Error ? err.message : String(err) }));
          }
        },
      })),
    ];

    const fileWatcher = createFileWatcher(jsonWatchSources);
    const watcher = fileWatcher.watcher;

    // Inline debounce scheduling (extracted for reuse by WatchSource callbacks)
    function scheduleDebounce() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        // If we're mid-branch-resolution, the connection string is being rebuilt.
        // Reschedule so we push to the right database once resolution completes.
        if (isResolvingBranchJson) {
          debounceTimer = setTimeout(async () => { applyPendingChanges(); }, 500);
          return;
        }
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

              const generated = runCodegenIfStale(cwd, freshConfig);
              console.log(
                JSON.stringify({
                  event: "config_sync_complete",
                  dryRun: options.dryRun ?? false,
                  applied: appliedCount,
                  ...(generated.length ? { generated } : {}),
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
    }

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
          writeFileSync(typesPath, resp.types);
          const generated = runCodegenIfStale(cwd, config);
          console.log(
            JSON.stringify({
              event: "types_updated",
              path: relative(cwd, typesPath),
              ...(generated.length ? { generated } : {}),
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
      cleanupBranchWatchJson();
      clearInterval(typesCheck);
      await fileWatcher.close();
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
  let isRunningHooks = false;
  const clearLine = () => {
    if (!isInteractive || !currentLine) return;
    process.stdout.write(`\r\x1b[K`);
    currentLine = "";
    heartbeatHasSpacer = false;
  };

  const writeLine = (msg: string) => {
    if (!isInteractive) return;
    process.stdout.write(`\r${msg}\x1b[K`);
    currentLine = msg;
  };

  // Clack spinner for async operations
  let activeSpinner: ReturnType<typeof p.spinner> | null = null;

  // Notifications buffered while spinner is active (stdout conflicts with spinner animation)
  const pendingNotifications: string[] = [];

  const flushNotifications = () => {
    if (pendingNotifications.length === 0) return;
    console.log(S_BAR);
    for (const msg of pendingNotifications) {
      console.log(`${S_BAR}  ${msg}`);
    }
    pendingNotifications.length = 0;
  };

  // Log a line with the rail
  const logRail = (msg: string) => {
    if (isSpinnerActive) {
      pendingNotifications.push(msg);
      return;
    }
    clearLine();
    console.log(`${S_BAR}  ${msg}`);
    lastActivity = Date.now();
  };

  // Log a nested item under a step
  const logNested = (msg: string) => {
    clearLine();
    console.log(`${S_BAR}  ${C.secondary}${msg}${C.reset}`);
    lastActivity = Date.now();
  };

  // Log a verbose diagnostic line — only when --verbose is set
  const logVerbose = (msg: string) => {
    if (options.verbose) logNested(verboseLog(msg));
  };

  // Route pg-delta's internal verbose logs through the rail
  if (options.verbose) setLogCallback((msg) => logNested(verboseLog(msg)));

  // Start a clack spinner step
  const startStep = (msg: string) => {
    lastActivity = Date.now();
    stopHeartbeat();
    heartbeatStarted = false;
    isSpinnerActive = true;
    if (isInteractive) {
      activeSpinner = p.spinner();
      activeSpinner.start(msg);
    }
  };

  // Complete a step — stops spinner and shows result as a clack step
  const completeStep = (msg: string, summary?: string, status: "success" | "warning" | "error" = "success", detail?: string) => {
    isSpinnerActive = false;
    const resultMsg = summary
      ? `${msg} ${C.secondary}·${C.reset} ${C.secondary}${summary}${C.reset}`
      : msg;
    if (activeSpinner) {
      activeSpinner.stop(resultMsg);
      activeSpinner = null;
    }
    if (detail) {
      const color = status === "error" ? C.error : status === "warning" ? C.warning : C.secondary;
      const lines = detail.split("\n");
      for (const line of lines) {
        console.log(`${S_BAR}  ${color}${line}${C.reset}`);
      }
    }
    flushNotifications();
    lastActivity = Date.now();
    heartbeatStarted = true;
    startHeartbeat();
  };

  // Cancel an active step — stops spinner silently, no output in history
  const cancelStep = () => {
    isSpinnerActive = false;
    if (activeSpinner) {
      activeSpinner.stop("");
      activeSpinner = null;
      // Erase the empty diamond line clack wrote
      if (isInteractive) {
        process.stdout.write(`\x1b[A\r\x1b[K`);
      }
    }
    flushNotifications();
    heartbeatStarted = true;
    lastActivity = 0;
    startHeartbeat();
  };

  let heartbeatStarted = false;
  let heartbeatHasSpacer = false;

  const startHeartbeat = () => {
    // The heartbeat uses writeLine (\r animation) which only works in a TTY.
    // Don't start it in non-interactive environments — it would flood the output
    // with a new "Watching for changes..." line every 350ms.
    if (!isInteractive || heartbeatInterval) return;

    heartbeatInterval = setInterval(() => {
      const idle = Date.now() - lastActivity > 1000;
      if (idle && !isSpinnerActive) {
        if (!heartbeatHasSpacer) {
          process.stdout.write(`\n`);
          heartbeatHasSpacer = true;
        }
        heartbeatStarted = true;
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
    clearLine();
  };

  // Types tracking - shared between sync and interval
  let lastTypesRefreshTime = 0;

  // Print Clack-style header
  printCommandHeader({
    command: "supa dev",
    description: ["Watch for schema and config changes."],
  });
  const mainProjectRef = config.project_id ?? projectRef;
  const extra: [string, string][] = [
    ["Schema", relative(cwd, schemaDir)],
  ];
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
  printProjectContextLines({
    projectRef,
    mainProjectRef,
    gitBranch: currentBranch,
    profileName: profile?.name,
    dashboardUrl: `${SUPABASE_DASHBOARD_URL}/project/${projectRef}`,
    extra,
  });

  // Run codegen at startup in case database.ts is newer than generated files
  runCodegenIfStale(
    cwd,
    config,
    (f) => logNested(fmtGenerated(f)),
    options.verbose ? (msg) => logNested(msg) : undefined,
  );

  let lastBranch = currentBranch;

  // Branch watcher
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
          logRail(`→ Branch ${C.fileName}${newBranch}${C.reset} → profile ${C.value}${matched.name}${C.reset}`);
        } else {
          logRail(`→ Branch ${C.fileName}${newBranch}${C.reset}`);
        }

        const workflowProfile = getWorkflowProfile(config);
        if (isBranchingProfile(workflowProfile) && config.project_id) {
          if (!isResolvingBranch) {
            isResolvingBranch = true;
            logVerbose(`branch: resolving project ref for "${newBranch}"…`);
            resolveBranchAndWriteEnv({
              cwd,
              gitBranch: newBranch,
              mainProjectRef: config.project_id,
              token,
              productionBranch: config.production_branch as string | undefined,
            }).then(async (result) => {
              if (result) {
                state.projectRef = result.projectRef;
                logVerbose(`branch: resolved → ${result.projectRef} (${result.isBranch ? "preview" : "main"})`);
                // Rebuild connection string for the new project ref
                try {
                  logVerbose(`pooler: fetching connection string for ${result.projectRef}…`);
                  const cs = await resolveConnectionString(
                    client,
                    result.projectRef,
                    process.env.SUPABASE_DB_PASSWORD ?? dbPassword,
                  );
                  if (cs) {
                    state.connectionString = cs;
                    logVerbose(`pooler: connected`);
                  }
                } catch {
                  // Non-fatal — keep existing connection string
                }
                logRail(`Updated .env.local → ${result.isBranch ? "branch" : "main"} (${result.projectRef})`);
              } else {
                logVerbose(`branch: no healthy branch found for "${newBranch}"`);
                logRail(`No healthy Supabase branch for "${newBranch}" — run \`supa project branches create\``);
              }
            }).catch((err) => {
              logRail(`Branch env update failed: ${err instanceof Error ? err.message : String(err)}`);
            }).finally(() => {
              isResolvingBranch = false;
            });
          }
        }
      }
    });
  }

  type ConfigChange = { key: string; oldValue: string; newValue: string };

  // Compare local config against remote and apply any differences.
  // Returns the list of changes (empty = already in sync). Throws on API error.
  const syncConfig = async (freshConfig: ProjectConfig): Promise<ConfigChange[]> => {
    const allChanges: ConfigChange[] = [];

    const postgrestPayload = buildPostgrestPayload(freshConfig);
    if (postgrestPayload && Object.keys(postgrestPayload).length > 0) {
      logVerbose(`GET /v1/projects/${state.projectRef}/config/postgrest`);
      const remoteConfig = await client.getPostgrestConfig(state.projectRef!);
      const diffs = compareConfigs(
        postgrestPayload as Record<string, unknown>,
        remoteConfig as Record<string, unknown>,
      );
      const changedDiffs = diffs.filter((d) => d.changed);
      logVerbose(`config: postgrest — ${changedDiffs.length} change(s)`);
      for (const diff of changedDiffs) {
        allChanges.push({
          key: `api.${diff.key}`,
          oldValue: formatConfigValue(diff.oldValue),
          newValue: formatConfigValue(diff.newValue),
        });
      }
      if (!options.dryRun && changedDiffs.length > 0) {
        logVerbose(`PATCH /v1/projects/${state.projectRef}/config/postgrest`);
        await client.updatePostgrestConfig(state.projectRef!, postgrestPayload);
      }
    }

    const authPayload = buildAuthPayload(freshConfig);
    if (authPayload && Object.keys(authPayload).length > 0) {
      logVerbose(`GET /v1/projects/${state.projectRef}/config/auth`);
      const remoteConfig = await client.getAuthConfig(state.projectRef!);
      const diffs = compareConfigs(
        authPayload as Record<string, unknown>,
        remoteConfig as Record<string, unknown>,
      );
      const changedDiffs = diffs.filter((d) => d.changed);
      logVerbose(`config: auth — ${changedDiffs.length} change(s)`);
      for (const diff of changedDiffs) {
        allChanges.push({
          key: `auth.${diff.key}`,
          oldValue: formatConfigValue(diff.oldValue),
          newValue: formatConfigValue(diff.newValue),
        });
      }
      if (!options.dryRun && changedDiffs.length > 0) {
        logVerbose(`PATCH /v1/projects/${state.projectRef}/config/auth`);
        await client.updateAuthConfig(state.projectRef!, authPayload);
      }
    }

    return allChanges;
  };

  // Show config change details under the rail
  const logConfigChanges = (changes: ConfigChange[]) => {
    for (const change of changes.slice(0, 5)) {
      clearLine();
      console.log(`${S_BAR}  ${change.key}: ${C.warning}${change.oldValue}${C.reset} ${C.secondary}→${C.reset} ${C.value}${change.newValue}${C.reset}`);
      lastActivity = Date.now();
    }
    if (changes.length > 5) logNested(`+${changes.length - 5} more`);
  };

  // Apply config changes (called from file watcher)
  const applyConfigChanges = async () => {
    startStep("Comparing config with remote");
    try {
      const freshConfig = loadProjectConfig(cwd) as ProjectConfig;
      if (!freshConfig) {
        completeStep("Config push failed", "could not reload config.json", "error");
        return;
      }
      const allChanges = await syncConfig(freshConfig);
      if (allChanges.length === 0) {
        cancelStep();
      } else if (options.dryRun) {
        completeStep("Would push to remote", `${allChanges.length} config change${allChanges.length === 1 ? "" : "s"} (dry-run)`);
        logConfigChanges(allChanges);
      } else {
        completeStep("Pushed config to remote", `${allChanges.length} change${allChanges.length === 1 ? "" : "s"}`);
        logConfigChanges(allChanges);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      completeStep("Config push failed", undefined, "error", msg);
    }
  };

  // Apply schema changes
  const applySchemaChanges = async (changedFiles: string[]) => {
    startStep("Comparing schema with remote");

    try {
      if (options.dryRun) {
        // Dry run - just show the diff
        logVerbose(`pg-delta: computing diff…`);
        const diff = await diffSchemaWithPgDelta(
          state.connectionString!,
          schemaDir,
        );
        logVerbose(`pg-delta: ${diff.hasChanges ? `${diff.statements.length} statement(s)` : "no changes"}`);

        if (!diff.hasChanges) {
          cancelStep();
        } else {
          completeStep("Would push to remote", `${diff.statements.length} schema statement${diff.statements.length === 1 ? "" : "s"} (dry-run)`);
          for (const stmt of diff.statements.slice(0, 5)) {
            logNested(stmt.length > 60 ? stmt.slice(0, 57) + "..." : stmt);
          }
          if (diff.statements.length > 5) {
            logNested(`+${diff.statements.length - 5} more`);
          }
        }
      } else {
        // Actually apply
        logVerbose(`pg-delta: applying schema…`);
        const result = await applySchemaWithPgDelta(
          state.connectionString!,
          schemaDir,
        );
        logVerbose(`pg-delta: ${result.success ? `${result.statements ?? 0} statement(s) applied` : `failed — ${result.output?.slice(0, 80)}`}`);

        if (result.success) {
          if (result.output === "No changes to apply") {
            cancelStep();
          } else {
            // Refresh types and run codegen while spinner is active
            // Collect generated files to show after the spinner stops
            const generated: string[] = [];
            const typesResult = await refreshTypesAndCodegen({
              getTypes: () => client.getTypescriptTypes(state.projectRef!, "public"),
              cwd,
              config,
              onGenerated: (f) => generated.push(f),
              onLog: options.verbose ? (msg) => logNested(msg) : undefined,
              onRetry: (n, delay, max) => logNested(`${C.warning}⚠${C.reset} PostgREST schema cache not ready, retrying in ${delay / 1000}s… (${n}/${max})`),
            });
            if (typesResult.typesRefreshed) {
              lastTypesRefreshTime = Date.now();
            }

            const parts: string[] = [`${result.statements ?? 0} statement${(result.statements ?? 0) === 1 ? "" : "s"}`];
            if (typesResult.typesRefreshed) parts.push("types updated");
            completeStep("Pushed schema to remote", parts.join(", "));

            for (const file of changedFiles.slice(0, 5)) {
              logNested(file);
            }
            if (changedFiles.length > 5) {
              logNested(`+${changedFiles.length - 5} more files`);
            }
            for (const f of generated) {
              logNested(fmtGenerated(f));
            }
            if (typesResult.error) {
              logNested(`${C.warning}⚠${C.reset} Types refresh failed: ${typesResult.error}`);
            }
          }
        } else {
          completeStep("Schema push failed", undefined, "error", result.output);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      completeStep("Schema push failed", undefined, "error", msg);
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
    if (state.isApplying || isRunningHooks) return;
    if (
      state.pendingSchemaChanges.size === 0 &&
      !state.pendingConfigChange &&
      !state.pendingSeedChange
    )
      return;

    // If we're mid-branch-resolution, the connection string is still being rebuilt
    // for the new branch. Reschedule so we push to the right database once done.
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

    // Apply config first
    if (configChanged) {
      await applyConfigChanges();
      // Re-run codegen in case codegen settings (e.g. client_path) changed
      const freshConfig = loadProjectConfig(cwd);
      if (freshConfig) {
        config = freshConfig;
        runCodegenIfStale(
          cwd,
          config as ProjectConfig,
          (f) => logNested(fmtGenerated(f)),
          options.verbose ? (msg) => logNested(msg) : undefined,
        );
      }
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

    // If changes accumulated during apply (e.g. hook-generated SQL picked up by watcher), re-schedule
    if (state.pendingSchemaChanges.size > 0 || state.pendingConfigChange || state.pendingSeedChange) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { applyPendingChanges(); }, debounceMs);
    }
  };

  // Run pre-push hooks on startup (e.g., ORM codegen)
  const hooksConfigInteractive = (config as Record<string, unknown>).hooks as HooksConfig | undefined;
  if (hooksConfigInteractive?.pre_push) {
    startStep("Running pre-push hooks");
    try {
      await runHooksAsync(hooksConfigInteractive.pre_push, cwd, (msg) => {
        if (msg.startsWith("$ ")) logNested(msg);
      });
      completeStep("Pre-push hooks complete");
    } catch (err) {
      completeStep("Hook failed", undefined, "error", err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
  }

  // Build watch sources - schema, config, optionally seeds, and hook watch paths
  const interactiveHookSources = getHookWatchSources(hooksConfigInteractive?.pre_push, cwd);
  for (const src of interactiveHookSources) {
    logVerbose(`watching: ${src.raw} → ${src.dir}`);
  }

  // Shared handler: log change, queue it, debounce
  const scheduleChange = (label: string, event: string, queue: () => void) => {
    const eventIcon = event === "add" ? "+" : event === "unlink" ? "-" : "~";
    const eventColor = event === "add" ? C.success : event === "unlink" ? C.error : C.warning;
    logRail(`${eventColor}${eventIcon}${C.reset} ${label}`);
    queue();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { applyPendingChanges(); }, debounceMs);
  };

  const interactiveWatchSources: WatchSource[] = [
    {
      path: schemaDir,
      filter: (filePath) => filePath.endsWith(".sql"),
      onChange: (event, filePath) => {
        const relPath = relative(schemaDir, filePath);
        scheduleChange(relPath, event, () => state.pendingSchemaChanges.add(relPath));
      },
    },
    {
      path: configPath,
      onChange: (event, _filePath) => {
        scheduleChange("config.json", event, () => { state.pendingConfigChange = true; });
      },
    },
    ...(seedEnabled && existsSync(seedDir)
      ? [{
          path: seedDir,
          filter: (filePath: string) => filePath.endsWith(".sql"),
          onChange: (event: string, filePath: string) => {
            const relPath = relative(seedDir, filePath);
            scheduleChange(`seeds/${relPath}`, event, () => { state.pendingSeedChange = true; });
          },
        }]
      : []),
    ...interactiveHookSources.map((src) => ({
      path: src.dir,
      filter: src.filter,
      onChange: async (event: string, filePath: string) => {
        // Suppress hook-source events during apply or while hooks are already running
        if (state.isApplying || isRunningHooks) return;
        const eventIcon = event === "add" ? "+" : event === "unlink" ? "-" : "~";
        const eventColor = event === "add" ? C.success : event === "unlink" ? C.error : C.warning;
        logRail(`${eventColor}${eventIcon}${C.reset} ${relative(cwd, filePath)}`);
        isRunningHooks = true;
        startStep("Running pre-push hooks");
        try {
          await runHooksAsync(hooksConfigInteractive!.pre_push!, cwd, (msg) => {
            if (msg.startsWith("$ ")) logNested(msg);
          });
          completeStep("Pre-push hooks complete");
        } catch (err) {
          completeStep("Hook failed", undefined, "error", err instanceof Error ? err.message : String(err));
        } finally {
          isRunningHooks = false;
        }
        // Hook output (e.g. SQL files) will be picked up by the schema watcher naturally
      },
    })),
  ];

  // Initial check — compare local schema + config against remote and push any differences
  // File watcher starts AFTER this completes to avoid the startup hook's schema writes
  // triggering a redundant second push.
  startStep("Comparing local state with remote");
  try {
    if (options.dryRun) {
      logVerbose(`pg-delta: computing diff…`);
      const diff = await diffSchemaWithPgDelta(connectionString, schemaDir);
      logVerbose(`pg-delta: ${diff.hasChanges ? `${diff.statements.length} statement(s)` : "no changes"}`);
      if (diff.hasChanges) {
        completeStep("Would push to remote", `${diff.statements.length} schema statement${diff.statements.length === 1 ? "" : "s"} (dry-run)`);
        for (const stmt of diff.statements.slice(0, 5)) {
          logNested(stmt.length > 60 ? stmt.slice(0, 57) + "..." : stmt);
        }
        if (diff.statements.length > 5) logNested(`+${diff.statements.length - 5} more`);
      } else {
        completeStep("No changes", "schema already matches remote");
      }
      if (seedEnabled) {
        const existingSeedFiles = findSeedFiles(seedPaths, supabaseDir);
        if (existingSeedFiles.length > 0) logNested(`Would seed ${existingSeedFiles.length} file(s)`);
      }
    } else {
      // Schema
      logVerbose(`pg-delta: applying schema…`);
      const schemaResult = await applySchemaWithPgDelta(connectionString, schemaDir);
      logVerbose(`pg-delta: ${schemaResult.success ? `${schemaResult.statements ?? 0} statement(s) applied` : `failed — ${schemaResult.output?.slice(0, 80)}`}`);
      if (!schemaResult.success) {
        completeStep("Schema push failed", undefined, "error", schemaResult.output);
        process.exitCode = 1;
        return;
      }
      const schemaChanged = schemaResult.output !== "No changes to apply";
      const schemaStatements = schemaResult.statements ?? 0;

      // Config
      logVerbose(`config: syncing…`);
      let configChanges: ConfigChange[] = [];
      const freshConfig = loadProjectConfig(cwd) as ProjectConfig;
      if (freshConfig) {
        try {
          configChanges = await syncConfig(freshConfig);
          logVerbose(`config: ${configChanges.length} change(s)`);
          config = freshConfig;
        } catch (error) {
          logNested(`${C.warning}⚠${C.reset} Config sync failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (!schemaChanged && configChanges.length === 0) {
        completeStep("No changes", "schema and config already match remote");
      } else {
        const parts: string[] = [];
        if (schemaChanged) parts.push(`${schemaStatements} schema statement${schemaStatements === 1 ? "" : "s"}`);
        if (configChanges.length > 0) parts.push(`${configChanges.length} config change${configChanges.length === 1 ? "" : "s"}`);
        completeStep("Pushed to remote", parts.join(", "));

        if (schemaChanged) {
          const typesResult = await refreshTypesAndCodegen({
            getTypes: () => client.getTypescriptTypes(state.projectRef!, "public"),
            cwd,
            config,
            onGenerated: (f) => logNested(fmtGenerated(f)),
            onLog: options.verbose ? (msg) => logNested(msg) : undefined,
            onRetry: (n, delay, max) => logNested(`${C.warning}⚠${C.reset} PostgREST schema cache not ready, retrying in ${delay / 1000}s… (${n}/${max})`),
          });
          if (typesResult.typesRefreshed) {
            logNested(fmtGenerated(relative(cwd, typesPath)));
            lastTypesRefreshTime = Date.now();
          } else if (typesResult.error) {
            logNested(`${C.warning}⚠${C.reset} Types refresh failed: ${typesResult.error}`);
          }
        }

        if (configChanges.length > 0) logConfigChanges(configChanges);
      }

      // Initial seed
      if (seedEnabled && !state.seedApplied) {
        await applySeed("initial");
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    completeStep("Initial sync failed", undefined, "error", msg);
    process.exitCode = 1;
    return;
  }

  // Start file watcher after initial sync to avoid duplicate pushes from startup hook writes
  const fileWatcher = createFileWatcher(interactiveWatchSources, {
    onReady: (watched) => {
      const dirs = Object.keys(watched);
      logVerbose(`watcher ready: ${dirs.length} dirs`);
      for (const dir of dirs) {
        logVerbose(`  ${dir}: ${watched[dir].join(", ")}`);
      }
    },
  });

  startHeartbeat();

  // Graceful shutdown
  const cleanup = async () => {
    stopHeartbeat();
    if (isSpinnerActive) cancelStep();
    if (cleanupBranchWatch) cleanupBranchWatch();
    if (debounceTimer) clearTimeout(debounceTimer);
    await fileWatcher.close();
    await closeSupabasePool();
    clearLine();
    console.log(`${C.pipe}└${C.reset}`);
    console.log("");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
