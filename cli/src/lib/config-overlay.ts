/**
 * Config overlay / merge engine.
 *
 * Loads a layered config for the current env/branch:
 *   config.json  (base — always loaded, supports .toml)
 *   + config.<env>.json        (e.g. config.production.json)
 *   + config.<branch>.json     (preview env only, e.g. config.feat-my-feature.json)
 *
 * Merge semantics:
 *   - objects  → deep merge (recurse)
 *   - scalars  → overlay wins
 *   - arrays   → overlay replaces entirely
 *   - null     → delete the key from the result
 *
 * NOTE: Routing fields (project_id, workflow_profile, production_branch,
 * environments, profiles) should NOT appear in overlay files — overlays are
 * for Supabase service config only (auth, api, db, storage, …). This
 * constraint is documented, not enforced in code.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadProjectConfig, type ProjectConfig } from "./config.js";
import { getEnvironmentForBranch } from "./config.js";

// ---------------------------------------------------------------------------
// Re-export ProjectConfigSchema for overlay validation.
// We replicate the minimal shape here so we can call .partial().passthrough().
// ---------------------------------------------------------------------------
const ProjectConfigSchema = z
  .object({
    project_id: z.string().optional(),
    project: z.object({ id: z.string().optional() }).optional(),
    production_branch: z.string().optional(),
    workflow_profile: z.string().optional(),
    profiles: z.record(z.unknown()).optional(),
    environments: z.record(z.string()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// sanitizeBranchName
// ---------------------------------------------------------------------------

/**
 * Sanitize a git branch name for use as a filename segment.
 * Replaces filesystem-unsafe characters with `-`.
 *
 * e.g. `feat/my-feature` → `feat-my-feature`
 */
export function sanitizeBranchName(branch: string): string {
  return branch.replace(/[/\\:*?"<>|]/g, "-");
}

// ---------------------------------------------------------------------------
// deepMergeConfig
// ---------------------------------------------------------------------------

/**
 * Deep-merge `overlay` on top of `base`.
 *
 * - Objects: recurse
 * - Arrays: overlay replaces entirely (no append/remove operators)
 * - null: delete the key from the result
 * - Scalars: overlay wins
 */
export function deepMergeConfig(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, overlayVal] of Object.entries(overlay)) {
    if (overlayVal === null) {
      // null → delete
      delete result[key];
    } else if (
      typeof overlayVal === "object" &&
      !Array.isArray(overlayVal) &&
      overlayVal !== null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key]) &&
      result[key] !== null
    ) {
      // Both sides are plain objects → recurse
      result[key] = deepMergeConfig(
        result[key] as Record<string, unknown>,
        overlayVal as Record<string, unknown>,
      );
    } else {
      // Scalar, array, or type mismatch → overlay wins
      result[key] = overlayVal;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// loadEffectiveConfig
// ---------------------------------------------------------------------------

export interface EffectiveConfig {
  config: ProjectConfig;
  /** Ordered list of config file paths actually loaded (relative names only). */
  layers: string[];
}

/**
 * Load the effective project config by merging overlay files on top of the
 * base `config.json` (or `config.toml`).
 *
 * Chain (files that exist are merged in order):
 *   1. `supabase/config.json`              — always (via loadProjectConfig)
 *   2. `supabase/config.<env>.json`        — if env is not "development" and file exists
 *   3. `supabase/config.<branch>.json`     — only when env is "preview" and file exists
 *
 * @param dir   Project root directory (cwd)
 * @param env   Resolved environment name (e.g. "production", "preview"). Pass
 *              `undefined` to fall back to base-only loading.
 * @param branch Current git branch (used for branch-level overlay in preview).
 */
export function loadEffectiveConfig(
  dir: string,
  env?: string,
  branch?: string,
): EffectiveConfig {
  const supabaseDir = join(dir, "supabase");

  // Step 1 — base config (supports .toml as well)
  const base = loadProjectConfig(dir);
  if (!base) {
    // Propagate the null so callers can handle missing config the same way
    // they do today (they check for null and exit).
    return { config: null as unknown as ProjectConfig, layers: [] };
  }

  // If no env provided, derive it from branch (same two-step approach)
  const resolvedEnv = env ?? (branch ? getEnvironmentForBranch(base, branch) : "development");

  const layers: string[] = ["config.json"];
  let merged: Record<string, unknown> = base as Record<string, unknown>;

  // Step 2 — env overlay (production, preview, staging, custom — not development)
  if (resolvedEnv && resolvedEnv !== "development") {
    const envFile = `config.${resolvedEnv}.json`;
    const envPath = join(supabaseDir, envFile);
    if (existsSync(envPath)) {
      const overlay = loadAndValidateOverlay(envPath, envFile);
      merged = deepMergeConfig(merged, overlay);
      layers.push(envFile);
    }
  }

  // Step 3 — branch overlay (only in preview env)
  if (resolvedEnv === "preview" && branch) {
    const sanitized = sanitizeBranchName(branch);
    const branchFile = `config.${sanitized}.json`;
    const branchPath = join(supabaseDir, branchFile);
    if (existsSync(branchPath)) {
      const overlay = loadAndValidateOverlay(branchPath, branchFile);
      merged = deepMergeConfig(merged, overlay);
      layers.push(branchFile);
    }
  }

  // Final validation of merged result
  const config = ProjectConfigSchema.parse(merged) as ProjectConfig;

  return { config, layers };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadAndValidateOverlay(
  filePath: string,
  displayName: string,
): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    throw new Error(
      `${displayName}: failed to parse JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${displayName}: overlay must be a JSON object`);
  }

  // Validate as a partial config (unknown keys allowed via passthrough)
  try {
    ProjectConfigSchema.partial().passthrough().parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(`${displayName}: ${err.message}`);
    }
    throw err;
  }

  return raw as Record<string, unknown>;
}
