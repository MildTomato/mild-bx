/**
 * Configuration management for CLI
 *
 * Supports multiple config formats:
 * - supabase/config.json (with JSON Schema support)
 * - supabase/config.toml (legacy)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "toml";
import { z } from "zod";

/**
 * Get access token from environment variable
 */
export function getAccessToken(): string | undefined {
  return process.env.SUPABASE_ACCESS_TOKEN;
}

// Profile configuration schema (our DX-specific profiles)
const ProfileSchema = z.object({
  mode: z.enum(["local", "preview", "remote"]).optional(),
  workflow: z.enum(["git", "dashboard"]).optional(),
  schema: z.enum(["declarative", "migrations"]).optional(),
  branches: z.array(z.string()).optional(),
  project: z.string().optional(),
});

// Our DX config extends the base Supabase config with profiles
// Use passthrough() to preserve all fields (api, auth, db, etc.)
const ProjectConfigSchema = z
  .object({
    // Standard Supabase config fields
    project_id: z.string().optional(),

    // Legacy format support
    project: z
      .object({
        id: z.string().optional(),
      })
      .optional(),

    // DX-specific profiles
    profiles: z.record(ProfileSchema).optional(),
  })
  .passthrough();

export type Profile = z.infer<typeof ProfileSchema> & { name: string };
export type ProjectConfig = z.infer<typeof ProjectConfigSchema> &
  Record<string, unknown>;

/**
 * Config file names in priority order
 */
const CONFIG_FILES = [
  "config.json", // JSON with schema support (preferred)
  "config.toml", // TOML (legacy/compatible)
];

/**
 * Load project config from ./supabase/config.{json,toml}
 * Tries JSON first, falls back to TOML
 */
export function loadProjectConfig(dir: string): ProjectConfig | null {
  const supabaseDir = join(dir, "supabase");

  for (const filename of CONFIG_FILES) {
    const configPath = join(supabaseDir, filename);

    if (!existsSync(configPath)) {
      continue;
    }

    try {
      const content = readFileSync(configPath, "utf-8");
      let parsed: unknown;

      if (filename.endsWith(".json")) {
        parsed = JSON.parse(content);
      } else if (filename.endsWith(".toml")) {
        parsed = parseToml(content);
      } else {
        continue;
      }

      return ProjectConfigSchema.parse(parsed);
    } catch (error) {
      console.error(`Failed to parse ${filename}: ${error}`);
      return null;
    }
  }

  return null;
}

/**
 * Get the project ID from config (supports both formats)
 */
export function getProjectId(config: ProjectConfig): string | undefined {
  return config.project_id || config.project?.id;
}

/**
 * Get a profile by name from config
 */
export function getProfile(
  config: ProjectConfig,
  name?: string,
): Profile | null {
  const profiles = config.profiles;
  if (!profiles) return null;

  if (name) {
    const profile = profiles[name];
    if (profile) {
      return { ...profile, name };
    }
    return null;
  }

  // Return first profile as default
  const firstKey = Object.keys(profiles)[0];
  if (firstKey) {
    return { ...profiles[firstKey], name: firstKey };
  }

  return null;
}

/**
 * Find a profile that matches the current git branch
 */
export function getProfileForBranch(
  config: ProjectConfig,
  branch: string,
): Profile | null {
  const profiles = config.profiles;
  if (!profiles) return null;

  for (const [name, profile] of Object.entries(profiles)) {
    if (profile.branches) {
      for (const pattern of profile.branches) {
        if (matchBranchPattern(branch, pattern)) {
          return { ...profile, name };
        }
      }
    }
  }

  return null;
}

/**
 * Match a branch name against a pattern (supports * wildcard)
 */
function matchBranchPattern(branch: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special chars
    .replace(/\*/g, ".*") // Convert * to .*
    .replace(/\?/g, "."); // Convert ? to .

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(branch);
}

/**
 * Get profile with auto-selection based on branch
 */
export function getProfileOrAuto(
  config: ProjectConfig,
  profileName?: string,
  currentBranch?: string,
): Profile | null {
  // Explicit profile name
  if (profileName) {
    return getProfile(config, profileName);
  }

  // Try to match current branch
  if (currentBranch) {
    const matched = getProfileForBranch(config, currentBranch);
    if (matched) return matched;
  }

  // Fall back to first profile
  return getProfile(config);
}

/**
 * Get project ref from profile or config
 */
export function getProjectRef(
  config: ProjectConfig,
  profile?: Profile | null,
): string | undefined {
  if (profile?.project) {
    return profile.project;
  }
  return getProjectId(config);
}

/**
 * List all profile names
 */
export function listProfileNames(config: ProjectConfig): string[] {
  return Object.keys(config.profiles || {});
}
