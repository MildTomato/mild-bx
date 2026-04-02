/**
 * Shared project context resolution for all project commands.
 *
 * Replaces the repeated config → profile → projectRef → auth boilerplate
 * found in every project command.
 */

import chalk from "chalk";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generated as fmtGenerated } from "./styles.js";
import {
  getAccessTokenAsync,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
  getWorkflowProfile,
  getEnvironmentForBranch,
  type ProjectConfig,
  type Profile,
} from "./config.js";
import { loadEffectiveConfig } from "./config-overlay.js";
import { isBranchingProfile } from "./workflow-profiles.js";
import { getCurrentBranch } from "./git.js";
import { EXIT_CODES } from "./exit-codes.js";
import { createClient } from "./api.js";
import { runCodegenIfStale } from "./precheck.js";
import { runHooks } from "./hooks.js";
import type { HooksConfig } from "@supabase-dx/config";
import { log } from "@clack/prompts";
import { setRemoteVariable, clearRemoteScope } from "./env-api-bridge.js";
import type { EnvScope } from "./env-server-types.js";
import type { Branch, SupabaseClient } from "./api.js";



export interface ProjectContext {
  cwd: string;
  config: ProjectConfig;
  configLayers: string[];
  branch: string;
  profile: Profile | null;
  projectRef: string;
  parentProjectRef: string;
  token: string;
  isBranch: boolean;
}

export interface ConfigContext {
  cwd: string;
  config: ProjectConfig;
  configLayers: string[];
  branch: string;
  profile: Profile | null;
}

const HEALTHY_BRANCH = "ACTIVE_HEALTHY";
const FAILED_BRANCH_STATUSES = new Set([
  "ACTIVE_UNHEALTHY",
  "INIT_FAILED",
  "REMOVED",
  "RESTORE_FAILED",
  "PAUSE_FAILED",
]);
const FAILED_BRANCH_JOB_STATUSES = new Set(["MIGRATIONS_FAILED", "FUNCTIONS_FAILED"]);
const BRANCH_SPINNER_FRAMES = ["◒", "◐", "◓", "◑"];

export class BranchResolutionError extends Error {
  constructor(
    public kind: "failed" | "not_ready" | "timeout",
    public branchStatus: string,
    public gitBranch: string,
  ) {
    super(branchStatus);
    this.name = "BranchResolutionError";
  }
}

function ensurePreviewOverlay(cwd: string): boolean {
  const previewOverlayPath = join(cwd, "supabase", "config.preview.json");
  if (!existsSync(previewOverlayPath)) {
    try {
      // Derive overlay $schema from the base config's $schema ref — same relative
      // path but pointing at config.overlay.schema.json instead of config.schema.json.
      let schemaRef: string | undefined;
      const baseConfigPath = join(cwd, "supabase", "config.json");
      if (existsSync(baseConfigPath)) {
        try {
          const base = JSON.parse(require("node:fs").readFileSync(baseConfigPath, "utf-8"));
          if (typeof base.$schema === "string") {
            schemaRef = base.$schema.replace("config.schema.json", "config.overlay.schema.json");
          }
        } catch { /* ignore */ }
      }

      const content = schemaRef
        ? JSON.stringify({ $schema: schemaRef }, null, 2) + "\n"
        : "{}\n";

      writeFileSync(previewOverlayPath, content, { encoding: "utf-8" });
      return true;
    } catch {
      // Non-fatal — ignore write errors
    }
  }
  return false;
}

function raiseForBranchStatus(status: string, gitBranch: string): never {
  if (FAILED_BRANCH_STATUSES.has(status) || FAILED_BRANCH_JOB_STATUSES.has(status)) {
    throw new BranchResolutionError("failed", status, gitBranch);
  }
  if (status === "TIMEOUT") {
    throw new BranchResolutionError("timeout", status, gitBranch);
  }
  throw new BranchResolutionError("not_ready", status, gitBranch);
}

async function writeResolvedBranchEnv(options: {
  cwd: string;
  projectRef: string;
  branchId: string;
  token: string;
  verbose?: boolean;
}): Promise<void> {
  const { writeBranchEnv } = await import("./env-file.js");

  try {
    const dbPass = await writeBranchEnv({
      cwd: options.cwd,
      projectRef: options.projectRef,
      branchId: options.branchId,
      token: options.token,
    });
    process.env.SUPABASE_DB_PASSWORD = dbPass;
  } catch (envErr) {
    if (process.env.SUPA_VERBOSE || options.verbose) {
      console.error(
        `[resolve-project] writeBranchEnv failed: ${envErr instanceof Error ? envErr.message : String(envErr)}`
      );
    }
  }
}

async function pollForHealthyBranch(options: {
  client: SupabaseClient;
  parentProjectRef: string;
  branchId: string;
  gitBranch: string;
  json?: boolean;
}): Promise<Branch> {
  const POLL_MS = 5000;
  const MAX_POLLS = 60;
  const isInteractive = !!process.stdout.isTTY && !options.json;
  let spinnerFrame = 0;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    const branches = await options.client.listBranches(options.parentProjectRef);
    const branch = branches.find((candidate) => candidate.id === options.branchId);
    if (!branch) {
      break;
    }

    if (isInteractive) {
      const char = BRANCH_SPINNER_FRAMES[spinnerFrame % BRANCH_SPINNER_FRAMES.length];
      process.stdout.write(
        `\r${char}  Waiting for preview branch… (${branch.preview_project_status ?? "provisioning"})\x1b[K`
      );
      spinnerFrame++;
    }

    if (FAILED_BRANCH_JOB_STATUSES.has(branch.status)) {
      if (isInteractive) process.stdout.write("\r\x1b[K");
      raiseForBranchStatus(branch.status, options.gitBranch);
    }

    const projectStatus = branch.preview_project_status;
    if (projectStatus === HEALTHY_BRANCH) {
      if (isInteractive) process.stdout.write("\r\x1b[K");
      return branch;
    }
    if (projectStatus && FAILED_BRANCH_STATUSES.has(projectStatus)) {
      if (isInteractive) process.stdout.write("\r\x1b[K");
      raiseForBranchStatus(projectStatus, options.gitBranch);
    }
  }

  if (isInteractive) process.stdout.write("\r\x1b[K");
  raiseForBranchStatus("TIMEOUT", options.gitBranch);
}

async function finalizeBranchContext(options: {
  cwd: string;
  token: string;
  gitBranch: string;
  branch: Branch;
  verbose?: boolean;
}): Promise<{ projectRef: string; isBranch: boolean; overlayCreated: boolean }> {
  const projectStatus = options.branch.preview_project_status;
  if (projectStatus && projectStatus !== HEALTHY_BRANCH) {
    raiseForBranchStatus(projectStatus, options.gitBranch);
  }

  await writeResolvedBranchEnv({
    cwd: options.cwd,
    projectRef: options.branch.project_ref,
    branchId: options.branch.id,
    token: options.token,
    verbose: options.verbose,
  });

  const overlayCreated = ensurePreviewOverlay(options.cwd);
  return { projectRef: options.branch.project_ref, isBranch: true, overlayCreated };
}

export async function resolveBranchContext(options: {
  cwd: string;
  gitBranch: string;
  parentProjectRef: string;
  token: string;
  client: SupabaseClient;
  pollForHealth: boolean;
  createIfMissing?: boolean;
  json?: boolean;
  verbose?: boolean;
  profile?: string;
  productionBranch?: string;
}): Promise<{ projectRef: string; isBranch: boolean; overlayCreated: boolean } | null> {
  const {
    cwd,
    gitBranch,
    parentProjectRef,
    token,
    client,
    pollForHealth,
    createIfMissing = true,
    json,
    verbose,
    profile,
    productionBranch,
  } = options;
  const branches = await client.listBranches(parentProjectRef);

  const isProductionBranch =
    gitBranch === (productionBranch ?? "main") ||
    (!productionBranch && gitBranch === "master");

  if (isProductionBranch) {
    const defaultBranch = branches.find((branch) => branch.is_default);
    if (defaultBranch) {
      await writeResolvedBranchEnv({
        cwd,
        projectRef: parentProjectRef,
        branchId: defaultBranch.id,
        token,
        verbose,
      });
    }
    return { projectRef: parentProjectRef, isBranch: false, overlayCreated: false };
  }

  let match = branches.find((branch) => branch.git_branch === gitBranch);

  if (!match) {
    if (!createIfMissing) {
      return null;
    }
    if (pollForHealth) {
      if (json) {
        console.error(JSON.stringify({ status: "info", message: `Creating preview branch for "${gitBranch}"` }));
      } else {
        log.step(`Creating preview branch for "${gitBranch}"…`);
      }

      const created = await client.createBranch(parentProjectRef, {
        branch_name: gitBranch,
        git_branch: gitBranch,
      });
      match = await pollForHealthyBranch({
        client,
        parentProjectRef,
        branchId: created.id,
        gitBranch,
        json,
      });
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } else {
      const { createBranch } = await import("../commands/project/branches/src/create.js");

      if (json) {
        process.stderr.write(JSON.stringify({
          info: "CreatingBranch",
          message: `No preview branch for git branch "${gitBranch}" — creating one now.`,
          gitBranch,
        }) + "\n");
      } else {
        process.stderr.write(`  Creating preview branch for git branch "${gitBranch}"…\n`);
      }

      await createBranch(undefined, { profile, yes: true, noPush: true, subOperation: true, json });

      const updatedBranches = await client.listBranches(parentProjectRef);
      match = updatedBranches.find((branch) => branch.git_branch === gitBranch);
    }
  }

  if (!match) {
    return null;
  }

  if (pollForHealth && match.preview_project_status !== HEALTHY_BRANCH) {
    process.stderr.write(json ? "" : "  Waiting for preview branch to become healthy…\n");
    match = await pollForHealthyBranch({
      client,
      parentProjectRef,
      branchId: match.id,
      gitBranch,
      json,
    });
  }

  return finalizeBranchContext({
    cwd,
    token,
    gitBranch,
    branch: match,
    json,
    verbose,
  });
}

/**
 * Derive the env-server scope from the current project context.
 *
 * - local / branching-local (not on a branch) → "development"
 * - any branching profile + on a branch       → "preview"
 * - remote (no branching)                     → "production"
 */
export function resolveEnvScope(ctx: Pick<ProjectContext, "isBranch" | "config">): EnvScope {
  const profile = getWorkflowProfile(ctx.config);
  if (ctx.isBranch) return "preview";
  if (profile === "local" || profile === "branching-local") return "development";
  return "production";
}

/**
 * Fire-and-forget: push the 4 project config values to the env-server under scope "config".
 * Errors are silently swallowed — this must never block or break a command.
 */
function syncConfigToEnvServer(parentProjectRef: string, config: ProjectConfig): void {
  const entries: Array<{ key: string; value: string }> = [
    { key: "workflow_profile", value: config.workflow_profile as string },
    { key: "schema_management", value: (config as Record<string, unknown>).schema_management as string },
    { key: "config_source", value: (config as Record<string, unknown>).config_source as string },
    { key: "production_branch", value: config.production_branch as string },
  ].filter((e): e is { key: string; value: string } => typeof e.value === "string" && e.value.length > 0);

  if (entries.length === 0) return;

  clearRemoteScope(parentProjectRef, "config")
    .then(() =>
      setRemoteVariable(
        parentProjectRef,
        entries.map((e) => ({ key: e.key, value: e.value, secret: false, scope: "config" as const }))
      )
    )
    .catch(() => {
      // env-server may not be running — that's fine
    });
}

/**
 * Resolve full project context: config + profile + projectRef + auth token.
 * Exits the process on failure (missing config, missing project ref, or auth failure).
 */
export async function resolveProjectContext(options: {
  json?: boolean;
  profile?: string;
  skipBranchResolution?: boolean;
}): Promise<ProjectContext> {
  const { config, configLayers, cwd, branch, profile } = resolveConfig(options);

  const projectRef = getProjectRef(config, profile);
  if (!projectRef) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "No project ref" }));
    } else {
      console.error(chalk.red("No project ref configured. Run `supa init` first."));
    }
    process.exit(EXIT_CODES.CONFIG_NOT_FOUND);
  }

  let token = await getAccessTokenAsync();

  if (!token) {
    if (!options.json && process.stdin.isTTY) {
      // Pit of success: inline login before proceeding
      const { loginCommand } = await import("../commands/login/src/login.js");
      await loginCommand({});
      token = await getAccessTokenAsync();
      if (!token) {
        // loginCommand already printed the failure reason
        process.exit(EXIT_CODES.AUTH_FAILURE);
      }
    } else {
      if (options.json) {
        console.log(
          JSON.stringify({
            status: "error",
            message: "Not authenticated",
            hint: "Set SUPABASE_ACCESS_TOKEN or run `supa login`",
            exitCode: EXIT_CODES.AUTH_FAILURE,
          })
        );
      } else {
        console.error(
          chalk.red("Not logged in.") +
            " Run " +
            chalk.cyan("`supa login`") +
            " or set " +
            chalk.cyan("SUPABASE_ACCESS_TOKEN") +
            "."
        );
      }
      process.exit(EXIT_CODES.AUTH_FAILURE);
    }
  }

  // For branching profiles, resolve the Supabase branch ref matching the current git branch
  const workflowProfile = getWorkflowProfile(config);

  if (isBranchingProfile(workflowProfile) && branch && branch !== "main" && branch !== "master" && !options.skipBranchResolution) {
    try {
      const client = createClient(token);
      const branchContext = await resolveBranchContext({
        cwd,
        gitBranch: branch,
        parentProjectRef: projectRef,
        token,
        client,
        pollForHealth: false,
        json: options.json,
        verbose: (options as { verbose?: boolean }).verbose,
        profile: options.profile,
      });

      if (branchContext) {
        if (branchContext.overlayCreated) {
          if (options.json) {
            process.stderr.write(JSON.stringify({ info: "CreatedOverlay", file: "supabase/config.preview.json" }) + "\n");
          } else {
            log.info("Created supabase/config.preview.json — add preview-specific config overrides here.");
          }
        }
        syncConfigToEnvServer(projectRef, config);
        return {
          cwd,
          config,
          configLayers,
          branch,
          profile,
          projectRef: branchContext.projectRef,
          parentProjectRef: projectRef,
          token,
          isBranch: branchContext.isBranch,
        };
      }
    } catch (error) {
      if (error instanceof BranchResolutionError) {
        const message = error.kind === "failed"
          ? `Preview branch "${branch}" is in a failed state (${error.branchStatus}). Delete and recreate it.`
          : `Preview branch "${branch}" is not ready yet (${error.branchStatus}). Wait a moment and try again.`;

        if (options.json) {
          console.log(JSON.stringify({ status: "error", message, exitCode: 1 }));
        } else if (error.kind === "failed") {
          console.error(chalk.red(message));
        } else {
          console.error(chalk.yellow(message));
        }
        process.exit(1);
      }
      // If branch lookup fails (e.g. network error, 403 if branching not enabled),
      // fall through to the main project ref rather than blocking the whole command.
      // Log to stderr when --verbose is set so it's visible for debugging.
      if (process.env.SUPA_VERBOSE || (options as { verbose?: boolean }).verbose) {
        console.error(
          `[resolve-project] Branch lookup failed (falling through to main ref): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  // Run pre-push hooks here so they fire before every command that uses
  // resolveProjectContext — `supa push`, `supa project pull`, etc. — without
  // each command needing to call them explicitly.
  const hooks = (config as Record<string, unknown>).hooks as HooksConfig | undefined;
  if (hooks?.pre_push) {
    runHooks(hooks.pre_push, cwd, !options.json ? (msg) => process.stderr.write(chalk.dim(`  ${msg}\n`)) : undefined);
  }

  if (!options.json) {
    runCodegenIfStale(cwd, config, (f) => process.stderr.write(chalk.dim(`  ${fmtGenerated(f)}\n`)));
  } else {
    runCodegenIfStale(cwd, config);
  }

  syncConfigToEnvServer(projectRef, config);
  return { cwd, config, configLayers, branch, profile, projectRef, parentProjectRef: projectRef, token, isBranch: false };
}

/**
 * Resolve config context only (no auth, no projectRef requirement).
 * For commands like `profile` that only need config.
 * Exits on missing config.
 */
export function resolveConfig(options: {
  json?: boolean;
  profile?: string;
}): ConfigContext {
  const cwd = process.cwd();
  const branch = getCurrentBranch(cwd) || "main";

  // Two-step load: derive env from base config, then apply overlays
  const base = loadProjectConfig(cwd);
  if (!base) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "No config found" }));
    } else {
      console.error(chalk.red("No supabase/config.json found. Run `supa init` first."));
    }
    process.exit(EXIT_CODES.CONFIG_NOT_FOUND);
  }

  const env = getEnvironmentForBranch(base, branch);
  const { config, layers: configLayers } = loadEffectiveConfig(cwd, env, branch);

  const profile = getProfileOrAuto(config, options.profile, branch);

  return { cwd, config, configLayers, branch, profile };
}

/**
 * Require a TTY for interactive mode. Exits if not a TTY.
 */
export function requireTTY(): void {
  if (!process.stdin.isTTY) {
    console.error("Error: Interactive mode requires a TTY.");
    console.error("Use --json for non-interactive output.");
    process.exit(EXIT_CODES.GENERIC_ERROR);
  }
}
