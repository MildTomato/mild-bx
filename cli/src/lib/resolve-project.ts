/**
 * Shared project context resolution for all project commands.
 *
 * Replaces the repeated config → profile → projectRef → auth boilerplate
 * found in every project command.
 */

import chalk from "chalk";
import {
  requireAuth,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
  type ProjectConfig,
  type Profile,
} from "./config.js";
import { getCurrentBranch } from "./git.js";
import { EXIT_CODES } from "./exit-codes.js";

export interface ProjectContext {
  cwd: string;
  config: ProjectConfig;
  branch: string;
  profile: Profile | null;
  projectRef: string;
  token: string;
}

export interface ConfigContext {
  cwd: string;
  config: ProjectConfig;
  branch: string;
  profile: Profile | null;
}

/**
 * Resolve full project context: config + profile + projectRef + auth token.
 * Exits the process on failure (missing config, missing project ref, or auth failure).
 */
export async function resolveProjectContext(options: {
  json?: boolean;
  profile?: string;
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

  const token = await requireAuth({ json: options.json });

  return { cwd, config, branch, profile, projectRef, token };
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
