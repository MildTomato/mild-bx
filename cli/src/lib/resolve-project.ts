/**
 * Shared project context resolution for all project commands.
 *
 * Replaces the repeated config → profile → projectRef → auth boilerplate
 * found in every project command.
 */

import chalk from "chalk";
import { generated as fmtGenerated } from "./styles.js";
import {
  getAccessTokenAsync,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
  getWorkflowProfile,
  type ProjectConfig,
  type Profile,
} from "./config.js";
import { isBranchingProfile } from "./workflow-profiles.js";
import { getCurrentBranch } from "./git.js";
import { EXIT_CODES } from "./exit-codes.js";
import { createClient } from "./api.js";
import { runCodegenIfStale } from "./precheck.js";
import { runHooks } from "./hooks.js";
import type { HooksConfig } from "@supabase-dx/config";
import { setRemoteVariable } from "./env-api-bridge.js";
import type { EnvScope } from "./env-server-types.js";



export interface ProjectContext {
  cwd: string;
  config: ProjectConfig;
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
  branch: string;
  profile: Profile | null;
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

  setRemoteVariable(
    parentProjectRef,
    entries.map((e) => ({ key: e.key, value: e.value, secret: false, scope: "config" as const }))
  ).catch(() => {
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
  const { config, cwd, branch, profile } = resolveConfig(options);

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
      const branches = await client.listBranches(projectRef);
      const match = branches.find((b) => b.git_branch === branch);

      if (match) {
        const { writeBranchEnv } = await import("./env-file.js");
        try {
          const dbPass = await writeBranchEnv({ cwd, projectRef: match.project_ref, branchId: match.id, token });
          process.env.SUPABASE_DB_PASSWORD = dbPass;
        } catch (envErr) {
          // Non-fatal — but log so the user can diagnose stale .env.local warnings
          if (process.env.SUPA_VERBOSE || (options as { verbose?: boolean }).verbose) {
            console.error(`[resolve-project] writeBranchEnv failed: ${envErr instanceof Error ? envErr.message : String(envErr)}`);
          }
        }
        syncConfigToEnvServer(projectRef, config);
        return { cwd, config, branch, profile, projectRef: match.project_ref, parentProjectRef: projectRef, token, isBranch: true };
      } else {
        // No branch found — auto-create it. Same behaviour for interactive and --json:
        // creating the branch is always the right thing to do, no prompt needed.
        const { createBranch } = await import("../commands/project/branches/src/create.js");

        if (options.json) {
          process.stderr.write(JSON.stringify({
            info: "CreatingBranch",
            message: `No preview branch for git branch "${branch}" — creating one now.`,
            gitBranch: branch,
          }) + "\n");
        } else {
          process.stderr.write(`  Creating preview branch for git branch "${branch}"…\n`);
        }

        await createBranch(undefined, { profile: options.profile ?? undefined, yes: true, noPush: true });

        // Re-fetch and return the newly created branch
        const updatedBranches = await client.listBranches(projectRef);
        const created = updatedBranches.find((b) => b.git_branch === branch);
        if (created) {
          // Write credentials for this branch since it matches the current git branch
          const { writeBranchEnv } = await import("./env-file.js");
          try {
            const dbPass = await writeBranchEnv({ cwd, projectRef: created.project_ref, branchId: created.id, token });
            process.env.SUPABASE_DB_PASSWORD = dbPass;
          } catch (envErr) {
            // Non-fatal — but log so the user can diagnose stale .env.local warnings
            if (process.env.SUPA_VERBOSE || (options as { verbose?: boolean }).verbose) {
              console.error(`[resolve-project] writeBranchEnv failed: ${envErr instanceof Error ? envErr.message : String(envErr)}`);
            }
          }
          syncConfigToEnvServer(projectRef, config);
          return { cwd, config, branch, profile, projectRef: created.project_ref, parentProjectRef: projectRef, token, isBranch: true };
        }
        // If still not found, fall through to main ref — user can retry
      }
    } catch (error) {
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
  return { cwd, config, branch, profile, projectRef, parentProjectRef: projectRef, token, isBranch: false };
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
  const config = loadProjectConfig(cwd);

  if (!config) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "No config found" }));
    } else {
      console.error(chalk.red("No supabase/config.json found. Run `supa init` first."));
    }
    process.exit(EXIT_CODES.CONFIG_NOT_FOUND);
  }

  const branch = getCurrentBranch(cwd) || "main";
  const profile = getProfileOrAuto(config, options.profile, branch);

  return { cwd, config, branch, profile };
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
