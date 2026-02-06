/**
 * Configuration management for CLI
 *
 * Supports multiple config formats:
 * - supabase/config.json (with JSON Schema support)
 * - supabase/config.toml (legacy)
 *
 * Access token resolution (matches supabase-cli):
 * 1. SUPABASE_ACCESS_TOKEN env var
 * 2. OS keyring for current profile
 * 3. OS keyring for legacy key "access-token"
 * 4. ~/.supabase/access-token file
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { parse as parseToml } from "toml";
import { z } from "zod";
import { credentialStore } from "./credentials.js";

/**
 * Access token format: sbp_[a-f0-9]{40} or sbp_oauth_[a-f0-9]{40}
 */
const ACCESS_TOKEN_PATTERN = /^sbp_(oauth_)?[a-f0-9]{40}$/;

/**
 * Legacy keyring key for backwards compatibility
 */
const LEGACY_ACCESS_TOKEN_KEY = "access-token";

/**
 * Default profile name
 */
const DEFAULT_PROFILE = "supabase";

/**
 * Path to access token file (shared with supabase-cli)
 */
function getAccessTokenPath(): string {
  return join(homedir(), ".supabase", "access-token");
}

/**
 * Get the current profile name
 * Checks: --profile flag (via env), ./supabase/.temp/profile file, or default
 */
export function getCurrentProfileName(): string {
  // Check env var (set by --profile flag)
  const envProfile = process.env.SUPABASE_PROFILE;
  if (envProfile) {
    return envProfile;
  }

  // Check project-local profile file
  const profilePath = join(process.cwd(), "supabase", ".temp", "profile");
  if (existsSync(profilePath)) {
    try {
      const profile = readFileSync(profilePath, "utf-8").trim();
      if (profile) {
        return profile;
      }
    } catch {
      // Ignore read errors
    }
  }

  return DEFAULT_PROFILE;
}

/**
 * Get access token (async version with keyring support)
 *
 * Priority (matches supabase-cli):
 * 1. SUPABASE_ACCESS_TOKEN env var
 * 2. OS keyring for current profile
 * 3. OS keyring for legacy key "access-token"
 * 4. ~/.supabase/access-token file
 */
export async function getAccessTokenAsync(): Promise<string | undefined> {
  // 1. Env var takes precedence
  const envToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 2. Try keyring for current profile
  const profileName = getCurrentProfileName();
  const profileToken = await credentialStore.get(profileName);
  if (profileToken && ACCESS_TOKEN_PATTERN.test(profileToken)) {
    return profileToken;
  }

  // 3. Try keyring for legacy key
  if (profileName !== LEGACY_ACCESS_TOKEN_KEY) {
    const legacyToken = await credentialStore.get(LEGACY_ACCESS_TOKEN_KEY);
    if (legacyToken && ACCESS_TOKEN_PATTERN.test(legacyToken)) {
      return legacyToken;
    }
  }

  // 4. File fallback (shared with supabase-cli)
  const tokenPath = getAccessTokenPath();
  if (existsSync(tokenPath)) {
    try {
      const token = readFileSync(tokenPath, "utf-8").trim();
      if (ACCESS_TOKEN_PATTERN.test(token)) {
        return token;
      }
    } catch {
      // Ignore read errors
    }
  }

  return undefined;
}

/**
 * Get access token (sync version - only checks env and file)
 * Use getAccessTokenAsync() for full keyring support
 *
 * Priority:
 * 1. SUPABASE_ACCESS_TOKEN env var
 * 2. ~/.supabase/access-token file
 */
export function getAccessToken(): string | undefined {
  // Env var takes precedence
  const envToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (envToken) {
    return envToken;
  }

  // File fallback (shared with supabase-cli)
  const tokenPath = getAccessTokenPath();
  if (existsSync(tokenPath)) {
    try {
      const token = readFileSync(tokenPath, "utf-8").trim();
      if (ACCESS_TOKEN_PATTERN.test(token)) {
        return token;
      }
    } catch {
      // Ignore read errors
    }
  }

  return undefined;
}

/**
 * Check if user is logged in (has valid access token)
 */
export async function isLoggedInAsync(): Promise<boolean> {
  return (await getAccessTokenAsync()) !== undefined;
}

/**
 * Check if user is logged in (sync - only checks env and file)
 */
export function isLoggedIn(): boolean {
  return getAccessToken() !== undefined;
}

/**
 * Validate access token format
 */
export function isValidAccessToken(token: string): boolean {
  return ACCESS_TOKEN_PATTERN.test(token);
}

/**
 * Save access token (async - uses keyring with file fallback)
 * Stores in OS keyring for current profile, falls back to file
 */
export async function saveAccessTokenAsync(token: string): Promise<void> {
  if (!isValidAccessToken(token)) {
    throw new Error("Invalid access token format. Must be like `sbp_0102...1920`.");
  }

  const profileName = getCurrentProfileName();

  // Try keyring first
  try {
    await credentialStore.set(profileName, token);
    return;
  } catch {
    // Fall back to file
  }

  // File fallback
  saveAccessTokenToFile(token);
}

/**
 * Save access token to file only
 */
function saveAccessTokenToFile(token: string): void {
  const tokenPath = getAccessTokenPath();
  const tokenDir = dirname(tokenPath);

  // Create directory if it doesn't exist
  if (!existsSync(tokenDir)) {
    mkdirSync(tokenDir, { recursive: true, mode: 0o700 });
  }

  // Write token with restrictive permissions (owner read/write only)
  writeFileSync(tokenPath, token, { mode: 0o600 });
}

/**
 * Save access token (sync - file only)
 */
export function saveAccessToken(token: string): void {
  if (!isValidAccessToken(token)) {
    throw new Error("Invalid access token format. Must be like `sbp_0102...1920`.");
  }
  saveAccessTokenToFile(token);
}

/**
 * Delete access token (async - clears keyring and file)
 * Returns true if any token was deleted
 */
export async function deleteAccessTokenAsync(): Promise<boolean> {
  let deleted = false;

  // Delete from file
  const tokenPath = getAccessTokenPath();
  if (existsSync(tokenPath)) {
    try {
      unlinkSync(tokenPath);
      deleted = true;
    } catch {
      // Ignore errors
    }
  }

  // Delete legacy keyring key
  try {
    if (await credentialStore.delete(LEGACY_ACCESS_TOKEN_KEY)) {
      deleted = true;
    }
  } catch {
    // Ignore errors
  }

  // Delete current profile from keyring
  const profileName = getCurrentProfileName();
  try {
    if (await credentialStore.delete(profileName)) {
      deleted = true;
    }
  } catch {
    // Ignore errors
  }

  return deleted;
}

/**
 * Delete access token (sync - file only)
 */
export function deleteAccessToken(): boolean {
  const tokenPath = getAccessTokenPath();

  if (!existsSync(tokenPath)) {
    return false;
  }

  try {
    unlinkSync(tokenPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a helpful message when not logged in
 */
export function getLoginHint(): string {
  return "Not logged in. Run `supa login` or set SUPABASE_ACCESS_TOKEN environment variable.";
}

// Profile configuration schema (our DX-specific profiles)
const ProfileSchema = z.object({
  mode: z.enum(["local", "preview", "remote"]).optional(),
  workflow: z.enum(["git", "dashboard"]).optional(),
  schema: z.enum(["declarative", "migrations"]).optional(),
  branches: z.array(z.string()).optional(),
  project: z.string().optional(),
});

// Workflow profile types (new DX concept)
export const WorkflowProfileType = z.enum(["solo", "staged", "preview", "preview-git"]);
export type WorkflowProfile = z.infer<typeof WorkflowProfileType>;

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

    // Workflow profile (new: determines how commands behave)
    workflow_profile: WorkflowProfileType.optional(),

    // DX-specific profiles (old system: for branch-based environment mapping)
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
  const profile = getProfile(config);
  if (profile) return profile;

  // No profiles block: use project_id as default so push/pull work without a profile
  if (getProjectId(config)) {
    return { name: "default" };
  }
  return null;
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

/**
 * Get the workflow profile from config
 * Defaults to 'solo' if not specified
 */
export function getWorkflowProfile(config: ProjectConfig): WorkflowProfile {
  return config.workflow_profile || "solo";
}
